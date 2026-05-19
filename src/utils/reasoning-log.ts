/**
 * Structured reasoning trace system for ORPHEUS.
 * Writes reasoning traces to workspace so Orpheus can audit its own thinking,
 * catch contradictions, and provide the user with an audit trail.
 */

import path from "node:path";
import { debug } from "./debug-logger";
import { atomicWriteFile, safeReadFile } from "../ai/crash-resistant-state";
import { getAppConfigDir } from "./preferences";

const REASONING_LOG_FILE = "reasoning-trace.jsonl";
const MAX_ENTRIES = 100;

export interface ReasoningEntry {
	id: string;
	timestamp: string;
	task: string;
	assumptions: string[];
	decisions: Array<{
		branch: string;
		reason: string;
		rejected?: string[];
	}>;
	deadEnds?: Array<{
		attempt: string;
		whyItFailed: string;
	}>;
	confidence: "high" | "medium" | "low" | "uncertain";
	conclusion: string;
	actionPlan?: string[];
}

export interface ReasoningSession {
	startedAt: string;
	completedAt?: string;
	entries: ReasoningEntry[];
}

function getReasoningLogPath(): string {
	return path.join(getAppConfigDir(), REASONING_LOG_FILE);
}

function makeId(): string {
	return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Append a reasoning entry to the log.
 */
export async function appendReasoning(
	entry: Omit<ReasoningEntry, "id" | "timestamp">
): Promise<ReasoningEntry> {
	const full: ReasoningEntry = {
		id: makeId(),
		timestamp: new Date().toISOString(),
		...entry,
	};

	try {
		const logPath = getReasoningLogPath();
		const existing = await safeReadFile(logPath);
		const lines = existing ? existing.trim().split("\n").filter(Boolean) : [];
		lines.push(JSON.stringify(full));

		// Keep only last MAX_ENTRIES
		const trimmed = lines.slice(-MAX_ENTRIES);
		await atomicWriteFile(logPath, `${trimmed.join("\n")}\n`);
	} catch (error) {
		debug.error("reasoning-log", {
			message: "Failed to write reasoning entry",
			error: error instanceof Error ? error.message : String(error),
		});
	}

	return full;
}

/**
 * Read recent reasoning entries.
 */
export async function readReasoningLog(limit = 10): Promise<ReasoningEntry[]> {
	try {
		const logPath = getReasoningLogPath();
		const raw = await safeReadFile(logPath);
		if (!raw) return [];

		const entries = raw
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				try {
					return JSON.parse(line) as ReasoningEntry;
				} catch {
					return null;
				}
			})
			.filter(Boolean) as ReasoningEntry[];

		return entries.slice(-limit).reverse();
	} catch (error) {
		debug.error("reasoning-log", {
			message: "Failed to read reasoning log",
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

/**
 * Summarize recent reasoning for prompt injection.
 */
export async function buildReasoningSummary(task?: string, limit = 3): Promise<string> {
	const entries = await readReasoningLog(limit);
	if (entries.length === 0) return "";

	const filtered = task
		? entries.filter((e) => e.task.toLowerCase().includes(task.toLowerCase()))
		: entries;
	if (filtered.length === 0) return "";

	const lines = filtered.map((e) => {
		const parts = [
			`[${e.timestamp.slice(0, 16)}] ${e.task}`,
			`  assumptions: ${e.assumptions.join("; ")}`,
			`  decisions: ${e.decisions.map((d) => `${d.branch} (${d.reason})`).join(" | ")}`,
			e.deadEnds
				? `  dead-ends: ${e.deadEnds.map((d) => `${d.attempt}: ${d.whyItFailed}`).join(" | ")}`
				: "",
			`  confidence: ${e.confidence} | conclusion: ${e.conclusion}`,
		].filter(Boolean);
		return parts.join("\n");
	});

	return `<reasoning-trace>
Recent reasoning entries${task ? ` related to '${task}'` : ""}:

${lines.join("\n\n")}
</reasoning-trace>`;
}
