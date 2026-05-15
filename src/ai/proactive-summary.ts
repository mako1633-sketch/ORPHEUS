/**
 * Proactive conversation auto-summarization.
 *
 * After every N turns (default 5), the oldest non-technical exchanges are
 * condensed into a short summary note. This keeps the context window lean
 * without waiting for the 85% emergency compaction threshold.
 *
 * Works on ModelMessage[] (the internal model history).
 */

import type { ModelMessage } from "../types";
import { debug } from "../utils/debug-logger";

const PROACTIVE_SUMMARY_INTERVAL = 5;
const SUMMARY_EXCHANGES = 3;
const SUMMARY_MAX_CHARS = 240;

export type TurnCounter = {
	count: number;
	summarized: number;
};

export function createTurnCounter(): TurnCounter {
	return { count: 0, summarized: 0 };
}

function isTerminalCommand(text: string): boolean {
	const lower = text.toLowerCase();
	return /^(bun|npm|git|cd|ls|cat|mkdir|touch|chmod|node|tsx|npx|yarn|pnpm|echo|grep|find|ps|kill|top|curl|wget|ssh|scp|rsync|docker|kubectl|terraform|ansible|pip|pytest|jest|vitest|cargo|rustc|make|cmake|javac|java)\s/.test(
		lower
	);
}

function containsFilePath(text: string): boolean {
	return /\b(?:src|__tests__|dist|node_modules|\.config|\.github|\.gitignore|package\.json|tsconfig|\.env)\b/.test(
		text
	);
}

/** Detect technical messages that should NOT be summarized away. */
function isNonTechnical(msg: ModelMessage): boolean {
	if (msg.role !== "user" && msg.role !== "assistant") return false;

	const text = typeof msg.content === "string" ? msg.content : "";
	if (!text.trim()) return false;

	// User commands are technical
	if (msg.role === "user" && isTerminalCommand(text)) return false;

	// Code blocks
	if (text.includes("```")) return false;

	// File paths
	if (containsFilePath(text)) return false;

	// URLs
	if (/https?:\/\/[^\s]+/.test(text)) return false;

	// Short status updates are technical
	if (
		msg.role === "assistant" &&
		(/^Done\./.test(text) ||
			/^Running/.test(text) ||
			/^Pushed/.test(text) ||
			/^Committed/.test(text) ||
			/^Fixed/.test(text) ||
			/^Implemented/.test(text))
	) {
		return false;
	}

	// Tables
	if (msg.role === "assistant" && text.includes("| ") && text.includes("\n---")) return false;

	return true;
}

function extractUserIntent(text: string): string {
	const firstSentence = text.split(/[.!?]/)[0] ?? "";
	const cleaned = firstSentence
		.replace(/^\s*(?:Can you|Please|Hey|Hi|Go ahead|I'd like|I want|Let's|Could you)\s*/i, "")
		.replace(/^\s*(?:to)\s+/i, "")
		.trim();
	return cleaned || text.slice(0, 80);
}

function extractAssistantAction(text: string): string {
	if (text.startsWith("Done.")) return "completed task";
	if (text.startsWith("Pushed")) return "pushed changes";
	if (text.startsWith("Committed")) return "committed changes";
	if (text.startsWith("Fixed")) return "fixed issue";
	if (text.startsWith("Implemented")) return "implemented feature";
	if (text.startsWith("Running")) return "ran commands";
	if (text.startsWith("Fetching")) return "fetched data";
	if (text.startsWith("Verified")) return "verified";
	return text.split(/[.:]/)[0]?.trim().slice(0, 60) || "responded";
}

export function buildSummary(exchanges: Array<{ user: string; assistant: string }>): string {
	const lines: string[] = ["Earlier conversation:"];
	for (const ex of exchanges) {
		const user = extractUserIntent(ex.user);
		const action = extractAssistantAction(ex.assistant);
		lines.push(`• ${user.slice(0, 60)} → ${action}`);
	}
	const full = lines.join("; ");
	return full.length > SUMMARY_MAX_CHARS ? `${full.slice(0, SUMMARY_MAX_CHARS - 3)}...` : full;
}

export function shouldProactivelySummarize(counter: TurnCounter): boolean {
	return counter.count > 0 && counter.count % PROACTIVE_SUMMARY_INTERVAL === 0;
}

/**
 * Proactively summarize the oldest non-technical exchanges in the model history.
 * Mutates the provided history array in place if summarization occurs.
 * Returns the number of exchanges summarized.
 */
export function applyProactiveSummary(history: ModelMessage[], counter: TurnCounter): number {
	if (!shouldProactivelySummarize(counter)) {
		return 0;
	}

	// Find first N user→assistant pairs that are both non-technical
	const exchanges: Array<{ user: string; assistant: string }> = [];
	let lastIncludedIndex = -1;

	for (let i = 0; i < history.length - 1 && exchanges.length < SUMMARY_EXCHANGES; i++) {
		const msgA = history[i];
		const msgB = history[i + 1];
		if (!msgA || !msgB) continue;

		if (msgA.role !== "user" || msgB.role !== "assistant") continue;
		if (!isNonTechnical(msgA) || !isNonTechnical(msgB)) continue;

		const userText = typeof msgA.content === "string" ? msgA.content : "";
		const assistantText = typeof msgB.content === "string" ? msgB.content : "";
		if (!userText.trim() || !assistantText.trim()) continue;

		exchanges.push({ user: userText, assistant: assistantText });
		lastIncludedIndex = i + 1;
		i++; // skip the assistant message in the next iteration
	}

	if (exchanges.length === 0) {
		debug.log("proactive-summary", "No non-technical exchange pairs to summarize");
		return 0;
	}

	if (exchanges.length < SUMMARY_EXCHANGES) {
		debug.log("proactive-summary", `Only ${exchanges.length} exchanges found — skipping`);
		return 0;
	}

	const summary = buildSummary(exchanges);
	const before = history
		.slice(0, lastIncludedIndex + 1)
		.filter((m) => m.role !== "user" && m.role !== "assistant");
	const after = history.slice(lastIncludedIndex + 1);

	// Mutate in place
	history.length = 0;
	history.push(...before, { role: "system", content: summary }, ...after);

	debug.log("proactive-summary", {
		turns: counter.count,
		exchangesSummarized: exchanges.length,
		originalLength: before.length + lastIncludedIndex + 1 + after.length,
		newLength: history.length,
	});

	return exchanges.length;
}
