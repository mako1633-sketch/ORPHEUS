/**
 * Local Knowledge Base / RAG
 * Indexes the user's Documents, codebases, and notes into a local vector store.
 * When the user asks about prior work, ORPHEUS searches its own files and
 * returns grounded answers with citations.
 */

import { Database } from "bun:sqlite";
import { promises as fs } from "node:fs";
import path from "node:path";
import { debug } from "../utils/debug-logger";
import { getAppConfigDir } from "../utils/preferences";
import { getOllamaBaseUrl } from "./model-config";

const KB_DB_FILE = "knowledge-base.sqlite";
const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_OVERLAP = 64;
const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const SUPPORTED_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".json",
	".md",
	".mdx",
	".txt",
	".yaml",
	".yml",
	".toml",
	".ini",
	".cfg",
	".sh",
	".py",
	".rs",
	".go",
	".java",
	".c",
	".cpp",
	".h",
	".hpp",
	".swift",
	".kt",
	".rb",
	".php",
	".sql",
	".html",
	".css",
	".scss",
	".less",
	".xml",
	".csv",
	".log",
]);

const IGNORED_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"out",
	"coverage",
	".turbo",
	".cache",
	"tmp",
	"temp",
	"vendor",
	"target",
	".tox",
]);

const IGNORED_FILES = new Set([
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"bun.lock",
	".DS_Store",
	"Thumbs.db",
]);

export interface KnowledgeChunk {
	id: string;
	sourcePath: string;
	content: string;
	startLine: number;
	endLine: number;
}

export interface KnowledgeHit {
	chunk: KnowledgeChunk;
	score: number;
}

function getKbDbPath(): string {
	return path.join(getAppConfigDir(), KB_DB_FILE);
}

let db: Database | null = null;
let initPromise: Promise<Database> | null = null;

function buildFtsQuery(input: string): string {
	const terms = input
		.toLowerCase()
		.match(/[a-z0-9_]{2,}/g)
		?.slice(0, 8);
	return terms?.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ") ?? "";
}

async function getDb(): Promise<Database | null> {
	if (db) return db;
	if (initPromise) return initPromise;
	initPromise = (async () => {
		const dbPath = getKbDbPath();
		await fs.mkdir(path.dirname(dbPath), { recursive: true });
		const database = new Database(dbPath);
		database.exec("PRAGMA journal_mode=WAL;");
		database.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        source_path TEXT NOT NULL,
        content TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        indexed_at TEXT NOT NULL
      );
    `);
		database.exec(`
      CREATE TABLE IF NOT EXISTS chunk_embeddings (
        chunk_id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
      );
    `);
		database.exec(`
      CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source_path);
    `);
		database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        content, content='chunks', content_rowid='rowid'
      );
    `);
		// FTS triggers
		database.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
    `);
		database.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END;
    `);
		database.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
    `);
		db = database;
		return database;
	})();
	try {
		return await initPromise;
	} catch (error) {
		debug.error("kb-init", {
			message: "Knowledge base init failed",
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	} finally {
		initPromise = null;
	}
}

async function tryEmbed(baseUrl: string, text: string, model: string): Promise<number[] | null> {
	const url = baseUrl.endsWith("/api/embeddings") ? baseUrl : `${baseUrl.replace(/\/$/, "")}/api/embeddings`;
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model, prompt: text.slice(0, 4000) }),
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { embedding?: number[] };
		return Array.isArray(data.embedding) ? data.embedding : null;
	} catch {
		return null;
	}
}

async function fetchEmbedding(text: string, model = "nomic-embed-text"): Promise<number[] | null> {
	const rawUrl = getOllamaBaseUrl(); // e.g. http://127.0.0.1:11434/v1 or https://ollama.com/v1
	const primary = rawUrl.replace(/\/v1\/?$/, "");
	let emb = await tryEmbed(primary, text, model);
	if (emb) return emb;

	// Fallback to local Ollama (handles remote/public env vars)
	if (primary !== "http://127.0.0.1:11434") {
		emb = await tryEmbed("http://127.0.0.1:11434", text, model);
	}
	return emb;
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

function shouldIndex(filePath: string): boolean {
	const base = path.basename(filePath);
	if (IGNORED_FILES.has(base)) return false;
	const ext = path.extname(filePath).toLowerCase();
	if (!SUPPORTED_EXTENSIONS.has(ext)) return false;
	const parts = filePath.split(path.sep);
	return !parts.some((p) => IGNORED_DIRS.has(p));
}

function chunkText(
	text: string,
	chunkSize = DEFAULT_CHUNK_SIZE,
	overlap = DEFAULT_OVERLAP
): Array<{ content: string; startLine: number; endLine: number }> {
	const lines = text.split("\n");
	const chunks: Array<{ content: string; startLine: number; endLine: number }> = [];
	let i = 0;
	while (i < lines.length) {
		const end = Math.min(i + chunkSize, lines.length);
		const content = lines.slice(i, end).join("\n");
		chunks.push({ content, startLine: i + 1, endLine: end });
		i += chunkSize - overlap;
		if (i >= lines.length) break;
	}
	return chunks;
}

async function* walkDir(dir: string): AsyncGenerator<string> {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!IGNORED_DIRS.has(entry.name)) {
				yield* walkDir(full);
			}
		} else if (entry.isFile() && shouldIndex(full)) {
			yield full;
		}
	}
}

/**
 * Index a directory tree into the knowledge base.
 * Re-indexes existing files (deletes old chunks first).
 */
export async function indexDirectory(dirPath: string): Promise<{ indexed: number; errors: number }> {
	const database = await getDb();
	if (!database) return { indexed: 0, errors: 0 };

	let indexed = 0;
	let errors = 0;

	for await (const filePath of walkDir(dirPath)) {
		try {
			const stat = await fs.stat(filePath);
			if (stat.size > MAX_FILE_SIZE) continue;

			const text = await fs.readFile(filePath, "utf8");
			const chunks = chunkText(text);

			// Delete existing chunks for this file
			const existing = database
				.prepare("SELECT id FROM chunks WHERE source_path = ?")
				.all(filePath) as Array<{ id: string }>;
			for (const row of existing) {
				database.prepare("DELETE FROM chunks WHERE id = ?").run(row.id);
				database.prepare("DELETE FROM chunk_embeddings WHERE chunk_id = ?").run(row.id);
			}

			const now = new Date().toISOString();
			for (const [index, chunk] of chunks.entries()) {
				const id = `kb-${path.basename(filePath)}-${chunk.startLine}-${index}-${Date.now().toString(36)}`;
				const embedding = await fetchEmbedding(chunk.content);
				database
					.prepare(
						"INSERT INTO chunks (id, source_path, content, start_line, end_line, indexed_at) VALUES (?, ?, ?, ?, ?, ?)"
					)
					.run(id, filePath, chunk.content, chunk.startLine, chunk.endLine, now);
				if (embedding) {
					database
						.prepare("INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)")
						.run(id, Buffer.from(new Float32Array(embedding).buffer));
				}
			}
			indexed++;
			if (indexed % 50 === 0) {
				debug.info("kb-index", { message: `Indexed ${indexed} files...` });
			}
		} catch {
			errors++;
		}
	}

	debug.info("kb-index", { message: `Indexing complete`, indexed, errors });
	return { indexed, errors };
}

/**
 * Search the knowledge base for relevant chunks.
 */
export async function searchKnowledgeBase(query: string, limit = 5): Promise<KnowledgeHit[]> {
	const database = await getDb();
	if (!database) return [];

	const queryEmbedding = await fetchEmbedding(query);
	if (!queryEmbedding) {
		// Fallback to FTS
		try {
			const ftsQuery = buildFtsQuery(query);
			if (!ftsQuery) return [];
			const rows = database
				.prepare(
					`SELECT c.id, c.source_path, c.content, c.start_line, c.end_line
         FROM chunks c
         JOIN chunks_fts fts ON c.rowid = fts.rowid
         WHERE chunks_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
				)
				.all(ftsQuery, limit) as Array<{
				id: string;
				source_path: string;
				content: string;
				start_line: number;
				end_line: number;
			}>;
			return rows.map((r) => ({
				chunk: {
					id: r.id,
					sourcePath: r.source_path,
					content: r.content,
					startLine: r.start_line,
					endLine: r.end_line,
				},
				score: 1.0,
			}));
		} catch {
			return [];
		}
	}

	try {
		const rows = database.prepare("SELECT chunk_id, embedding FROM chunk_embeddings").all() as Array<{
			chunk_id: string;
			embedding: Buffer;
		}>;

		const scored = rows
			.map((row) => {
				const buf = row.embedding;
				const arr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
				const score = cosineSimilarity(queryEmbedding, Array.from(arr));
				return { chunkId: row.chunk_id, score };
			})
			.filter((s) => s.score >= 0.35)
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);

		if (scored.length === 0) return [];

		const placeholders = scored.map(() => "?").join(",");
		const chunks = database
			.prepare(
				`SELECT id, source_path, content, start_line, end_line FROM chunks WHERE id IN (${placeholders})`
			)
			.all(...scored.map((s) => s.chunkId)) as Array<{
			id: string;
			source_path: string;
			content: string;
			start_line: number;
			end_line: number;
		}>;

		const byId = new Map(scored.map((s) => [s.chunkId, s.score]));
		return chunks
			.map((c) => ({
				chunk: {
					id: c.id,
					sourcePath: c.source_path,
					content: c.content,
					startLine: c.start_line,
					endLine: c.end_line,
				},
				score: byId.get(c.id) ?? 0,
			}))
			.sort((a, b) => b.score - a.score);
	} catch (error) {
		debug.error("kb-search", {
			message: "Search failed",
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

/**
 * Format knowledge hits for prompt injection with citations.
 */
export function formatKnowledgeHits(hits: KnowledgeHit[]): string {
	if (hits.length === 0) return "";
	const lines = hits.map((h, i) => {
		const relative = h.chunk.sourcePath.split("/").slice(-3).join("/");
		return `${i + 1}. **${relative}** (L${h.chunk.startLine}-${h.chunk.endLine})\n   > ${h.chunk.content.replace(/\n/g, "\n   > ").slice(0, 400)}`;
	});
	return `<local-knowledge>
Relevant content from indexed local files:

${lines.join("\n\n")}

Cite these sources when answering. If no source applies, say so.
</local-knowledge>`;
}
