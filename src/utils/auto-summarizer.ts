/**
 * Proactive auto-summarization for conversation context.
 *
 * After every N turns (default: 5), automatically condenses the oldest
 * non-technical exchanges into a 3-line summary. This keeps the prompt
 * lean without waiting for the emergency 85% compaction threshold.
 *
 * Summaries are stored in durable context (persistent-context) so they
 * survive new sessions.
 */

import { loadPersistentContext, savePersistentContext } from "../ai/persistent-context";
import type { ModelMessage } from "../types";
import { debug } from "./debug-logger";

const TURNS_BETWEEN_SUMMARIES = 5;
const SUMMARY_KEY = "conversation_summaries";
const TURN_COUNT_KEY = "conversation_turn_count";

export interface TurnSummary {
	index: number; // which turn this summary covers (0-based end index)
	turnCount: number; // how many turns were summarized
	content: string; // the 3-line summary
	createdAt: string;
}

/**
 * Track that a turn completed. Returns a summary if we've hit the threshold.
 */
export async function recordTurn(
	messages: ModelMessage[],
	currentTurnIndex: number
): Promise<TurnSummary | null> {
	const ctx = await loadPersistentContext();
	let turnCount = 0;
	try {
		const parsed = JSON.parse(ctx || "{}") as Record<string, unknown>;
		turnCount = typeof parsed[TURN_COUNT_KEY] === "number" ? (parsed[TURN_COUNT_KEY] as number) : 0;
	} catch {
		turnCount = 0;
	}
	turnCount += 1;

	// Save updated turn count
	try {
		const parsed = JSON.parse(ctx || "{}") as Record<string, unknown>;
		parsed[TURN_COUNT_KEY] = turnCount;
		await savePersistentContext(JSON.stringify(parsed, null, 2));
	} catch {
		// Best-effort
	}

	if (turnCount < TURNS_BETWEEN_SUMMARIES) {
		debug.info("auto-summarizer", { turnCount, nextSummaryAt: TURNS_BETWEEN_SUMMARIES });
		return null;
	}

	// Reset counter and summarize
	try {
		const parsed = JSON.parse(await loadPersistentContext()) as Record<string, unknown>;
		parsed[TURN_COUNT_KEY] = 0;
		await savePersistentContext(JSON.stringify(parsed, null, 2));
	} catch {
		// Best-effort
	}
	return await summarizeOldestMessages(messages, currentTurnIndex);
}

/**
 * Summarize the oldest non-technical messages into 3 lines.
 */
async function summarizeOldestMessages(
	messages: ModelMessage[],
	endIndex: number
): Promise<TurnSummary | null> {
	// Identify oldest ~TURNS_BETWEEN_SUMMARIES messages that are non-technical
	// We skip tool results, system messages, and code blocks
	const candidateMessages: ModelMessage[] = [];
	let examined = 0;
	for (let i = 0; i <= endIndex && i < messages.length; i += 1) {
		const msg = messages[i]!;
		if (msg.role === "system" || msg.role === "tool") continue;

		const text = extractText(msg);
		if (!text || isTechnicalOnly(text)) continue;

		candidateMessages.push(msg);
		examined += 1;
		if (examined >= TURNS_BETWEEN_SUMMARIES) break;
	}

	if (candidateMessages.length === 0) {
		debug.info("auto-summarizer", "No non-technical messages to summarize");
		return null;
	}

	const combined = candidateMessages.map((m) => `[${m.role}] ${extractText(m)}`).join("\n\n");

	// Simple heuristic summary: extract key questions/decisions
	const summary = generateHeuristicSummary(combined, candidateMessages.length);

	const turnSummary: TurnSummary = {
		index: endIndex,
		turnCount: candidateMessages.length,
		content: summary,
		createdAt: new Date().toISOString(),
	};

	// Persist into the durable context
	try {
		const ctx = await loadPersistentContext();
		const parsed = JSON.parse(ctx || "{}") as Record<string, unknown>;
		const existing = (parsed[SUMMARY_KEY] as TurnSummary[] | undefined) ?? [];
		existing.push(turnSummary);
		parsed[SUMMARY_KEY] = existing;
		await savePersistentContext(JSON.stringify(parsed, null, 2));
	} catch (err) {
		debug.error("auto-summarizer-persist-failed", {
			message: err instanceof Error ? err.message : String(err),
		});
	}

	debug.info("auto-summarizer", {
		turnsSummarized: turnSummary.turnCount,
		summaryPreview: summary.slice(0, 80),
	});

	return turnSummary;
}

function extractText(message: ModelMessage): string {
	if (typeof message.content === "string") return message.content;
	if (Array.isArray(message.content)) {
		return message.content
			.filter((p) => typeof p === "object" && p && "text" in p)
			.map((p) => (p as { text?: string }).text ?? "")
			.join("\n");
	}
	return "";
}

function isTechnicalOnly(text: string): boolean {
	// Skip if it's mostly code blocks, tool outputs, or JSON
	const codeBlockRatio = (text.match(/```/g)?.length ?? 0) / Math.max(text.split("\n").length, 1);
	if (codeBlockRatio > 0.3) return true;

	// Skip if it starts with common tool prefixes
	const toolPrefixes = ["Running ", "Executing ", "Result:", "Output:", "Error:", "$ "];
	if (toolPrefixes.some((p) => text.trim().startsWith(p))) return true;

	return false;
}

function generateHeuristicSummary(text: string, count: number): string {
	const lines = text.split("\n").filter((l) => l.trim().length > 0);

	// Extract questions (lines with ?)
	const questions = lines.filter((l) => l.includes("?")).slice(0, 2);

	// Extract decision/action items
	const decisions = lines.filter((l) =>
		/\b(let's|please|go ahead|start|proceed|implement|fix|add|remove|update)\b/i.test(l)
	);

	// Build 3-line summary
	const parts: string[] = [];
	parts.push(`Summary of ${count} turns:`);

	if (questions.length > 0) {
		parts.push(
			`Key topics: ${questions.map((q) => q.trim().replace(/^\[.*?\]\s*/, "")).join("; ")}`
		);
	} else {
		parts.push("Topics: general discussion and code work.");
	}

	if (decisions.length > 0) {
		parts.push(
			`Actions: ${decisions
				.slice(0, 2)
				.map((d) => d.trim().replace(/^\[.*?\]\s*/, ""))
				.join("; ")}`
		);
	} else {
		parts.push("No explicit decisions recorded.");
	}

	return parts.join("\n").slice(0, 400);
}

/**
 * Get all stored summaries.
 */
export async function getSummaries(): Promise<TurnSummary[]> {
	try {
		const ctx = await loadPersistentContext();
		const parsed = JSON.parse(ctx || "{}") as Record<string, unknown>;
		return (parsed[SUMMARY_KEY] as TurnSummary[] | undefined) ?? [];
	} catch {
		return [];
	}
}

/**
 * Reset the turn counter (e.g., after a new session).
 */
export async function resetTurnCounter(): Promise<void> {
	try {
		const ctx = await loadPersistentContext();
		const parsed = JSON.parse(ctx || "{}") as Record<string, unknown>;
		parsed[TURN_COUNT_KEY] = 0;
		await savePersistentContext(JSON.stringify(parsed, null, 2));
	} catch {
		// Best-effort
	}
}
