/**
 * Ollama-based Semantic Long-Term Memory
 * Purely local embedding + vector search using Ollama (no cloud API keys required).
 * Stores memories as chunked text with embeddings in a local SQLite vector store.
 * Falls back silently if Ollama is unavailable.
 */

import { Database } from "bun:sqlite";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { MemoryEntry } from "../types";
import { debug } from "../utils/debug-logger";
import { getAppConfigDir } from "../utils/preferences";
import { getOllamaBaseUrl } from "./model-config";

const OLLAMA_MEMORY_DB = "ollama-memory.sqlite";
const DEFAULT_EMBED_MODEL = "nomic-embed-text";
const MAX_MEMORY_CHARS = 4000;
const SIMILARITY_THRESHOLD = 0.65;

function getOllamaApiBaseUrl(): string {
	return getOllamaBaseUrl()
		.replace(/\/v1\/?$/, "")
		.replace(/\/$/, "");
}

function buildFtsQuery(input: string): string {
	const terms = input
		.toLowerCase()
		.match(/[a-z0-9_]{2,}/g)
		?.slice(0, 8);
	return terms?.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ") ?? "";
}

function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		dot += a[i]! * b[i]!;
		normA += a[i]! * a[i]!;
		normB += b[i]! * b[i]!;
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}

function getMemoryDbPath(): string {
	return path.join(getAppConfigDir(), OLLAMA_MEMORY_DB);
}

let db: Database | null = null;
let initPromise: Promise<Database> | null = null;

async function getDb(): Promise<Database | null> {
	if (db) return db;
	if (initPromise) return initPromise;
	initPromise = (async () => {
		const dbPath = getMemoryDbPath();
		await fs.mkdir(path.dirname(dbPath), { recursive: true });
		const database = new Database(dbPath);
		database.exec("PRAGMA journal_mode=WAL;");
		database.exec(`
			CREATE TABLE IF NOT EXISTS memories (
				id TEXT PRIMARY KEY,
				memory TEXT NOT NULL,
				metadata TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
		`);
		database.exec(`
			CREATE TABLE IF NOT EXISTS embeddings (
				memory_id TEXT PRIMARY KEY,
				embedding BLOB NOT NULL,
				FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
			);
		`);
		database.exec(`
			CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
				memory, content='memories', content_rowid='rowid'
			);
		`);
		database.exec(`
			CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
				INSERT INTO memories_fts(rowid, memory) VALUES (new.rowid, new.memory);
			END;
		`);
		database.exec(`
			CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
				INSERT INTO memories_fts(memories_fts, rowid, memory) VALUES ('delete', old.rowid, old.memory);
			END;
		`);
		database.exec(`
			CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
				INSERT INTO memories_fts(memories_fts, rowid, memory) VALUES ('delete', old.rowid, old.memory);
				INSERT INTO memories_fts(rowid, memory) VALUES (new.rowid, new.memory);
			END;
		`);
		db = database;
		return database;
	})();
	try {
		return await initPromise;
	} catch (error) {
		debug.error("ollama-memory-init", {
			message: "Failed to initialize Ollama memory DB",
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	} finally {
		initPromise = null;
	}
}

async function fetchEmbedding(text: string, model = DEFAULT_EMBED_MODEL): Promise<number[] | null> {
	const url = `${getOllamaApiBaseUrl()}/api/embeddings`;
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model, prompt: text.slice(0, MAX_MEMORY_CHARS) }),
		});
		if (!response.ok) {
			debug.warn("ollama-embed", { message: `HTTP ${response.status} from ${url}` });
			return null;
		}
		const data = (await response.json()) as { embedding?: number[] };
		if (!Array.isArray(data.embedding)) {
			debug.warn("ollama-embed", { message: "Missing embedding in response" });
			return null;
		}
		return data.embedding;
	} catch (error) {
		debug.warn("ollama-embed", {
			message: "Embedding request failed",
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

export async function isOllamaMemoryAvailable(): Promise<boolean> {
	try {
		const res = await fetch(`${getOllamaApiBaseUrl()}/api/tags`, { method: "GET" });
		return res.ok;
	} catch {
		return false;
	}
}

export async function ollamaAddMemory(
	memory: string,
	metadata?: Record<string, unknown>
): Promise<MemoryEntry | null> {
	const database = await getDb();
	if (!database) return null;

	const embedding = await fetchEmbedding(memory);
	if (!embedding) {
		debug.warn("ollama-memory", { message: "Skipping memory add — embedding unavailable" });
		return null;
	}

	const id = `ollama-mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	const now = new Date().toISOString();
	const metaJson = metadata ? JSON.stringify(metadata) : null;

	try {
		database
			.prepare(
				"INSERT INTO memories (id, memory, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
			)
			.run(id, memory.slice(0, MAX_MEMORY_CHARS), metaJson, now, now);
		database
			.prepare("INSERT INTO embeddings (memory_id, embedding) VALUES (?, ?)")
			.run(id, Buffer.from(new Float32Array(embedding).buffer));
		debug.info("ollama-memory", {
			message: "Memory added",
			id,
			memoryPreview: memory.slice(0, 60),
		});
		return {
			id,
			memory: memory.slice(0, MAX_MEMORY_CHARS),
			metadata,
			createdAt: now,
			updatedAt: now,
		};
	} catch (error) {
		debug.error("ollama-memory-add", {
			message: "Failed to add memory",
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

export async function ollamaSearchMemories(query: string, limit = 5): Promise<MemoryEntry[]> {
	const database = await getDb();
	if (!database) return [];

	const queryEmbedding = await fetchEmbedding(query);
	if (!queryEmbedding) {
		// Fallback to FTS if embeddings fail
		try {
			const ftsQuery = buildFtsQuery(query);
			if (!ftsQuery) return [];
			const rows = database
				.prepare(
					`SELECT m.id, m.memory, m.metadata, m.created_at, m.updated_at
				 FROM memories m
				 JOIN memories_fts fts ON m.rowid = fts.rowid
				 WHERE memories_fts MATCH ?
				 ORDER BY rank
				 LIMIT ?`
				)
				.all(ftsQuery, limit) as Array<{
				id: string;
				memory: string;
				metadata: string | null;
				created_at: string;
				updated_at: string;
			}>;
			return rows.map((r) => ({
				id: r.id,
				memory: r.memory,
				metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : undefined,
				createdAt: r.created_at,
				updatedAt: r.updated_at,
			}));
		} catch {
			return [];
		}
	}

	try {
		const rows = database.prepare("SELECT memory_id, embedding FROM embeddings").all() as Array<{
			memory_id: string;
			embedding: Buffer;
		}>;

		const scored = rows
			.map((row) => {
				const buf = row.embedding;
				const arr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
				const score = cosineSimilarity(queryEmbedding, Array.from(arr));
				return { memoryId: row.memory_id, score };
			})
			.filter((s) => s.score >= SIMILARITY_THRESHOLD)
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);

		if (scored.length === 0) return [];

		const placeholders = scored.map(() => "?").join(",");
		const memRows = database
			.prepare(
				`SELECT id, memory, metadata, created_at, updated_at FROM memories WHERE id IN (${placeholders})`
			)
			.all(...scored.map((s) => s.memoryId)) as Array<{
			id: string;
			memory: string;
			metadata: string | null;
			created_at: string;
			updated_at: string;
		}>;

		const byId = new Map(scored.map((s) => [s.memoryId, s.score]));
		return memRows
			.map((r) => ({
				id: r.id,
				memory: r.memory,
				score: byId.get(r.id),
				metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : undefined,
				createdAt: r.created_at,
				updatedAt: r.updated_at,
			}))
			.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
	} catch (error) {
		debug.error("ollama-memory-search", {
			message: "Search failed",
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

export async function ollamaDeleteMemory(id: string): Promise<boolean> {
	const database = await getDb();
	if (!database) return false;
	try {
		database.prepare("DELETE FROM memories WHERE id = ?").run(id);
		return true;
	} catch {
		return false;
	}
}

export async function ollamaResetMemories(): Promise<boolean> {
	const database = await getDb();
	if (!database) return false;
	try {
		database.prepare("DELETE FROM memories").run();
		database.prepare("DELETE FROM embeddings").run();
		debug.info("ollama-memory", { message: "All Ollama memories cleared" });
		return true;
	} catch (error) {
		debug.error("ollama-memory-reset", {
			message: "Reset failed",
			error: error instanceof Error ? error.message : String(error),
		});
		return false;
	}
}
