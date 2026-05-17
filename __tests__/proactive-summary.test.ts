import {
	applyProactiveSummary,
	buildSummary,
	shouldProactivelySummarize,
} from "../src/ai/proactive-summary";
import type { ModelMessage } from "../src/types";

describe("proactive summary", () => {
	function makeHistory(pairs: Array<{ user: string; assistant: string }>): ModelMessage[] {
		const history: ModelMessage[] = [];
		for (const { user, assistant } of pairs) {
			history.push({ role: "user", content: user });
			history.push({ role: "assistant", content: assistant });
		}
		return history;
	}

	describe("shouldProactivelySummarize", () => {
		it("returns false at count 0", () => {
			expect(shouldProactivelySummarize({ count: 0, summarized: 0 })).toBe(false);
		});
		it("returns false at count 4", () => {
			expect(shouldProactivelySummarize({ count: 4, summarized: 0 })).toBe(false);
		});
		it("returns true at count 5", () => {
			expect(shouldProactivelySummarize({ count: 5, summarized: 0 })).toBe(true);
		});
		it("returns true at count 10", () => {
			expect(shouldProactivelySummarize({ count: 10, summarized: 0 })).toBe(true);
		});
	});

	describe("buildSummary", () => {
		it("formats exchanges with intent arrows", () => {
			const summary = buildSummary([
				{ user: "What can you do?", assistant: "I can help with security." },
				{ user: "Run diagnostics", assistant: "Done. Everything looks good." },
			]);
			expect(summary).toContain("Earlier conversation:");
			expect(summary).toContain("→");
		});
	});

	describe("applyProactiveSummary", () => {
		it("returns 0 when turn count is not at interval", () => {
			const history = makeHistory([
				{ user: "What can you do?", assistant: "I can run diagnostics and security scans." },
				{ user: "Run diagnostics", assistant: "Done. Everything looks good." },
			]);
			const counter = { count: 2, summarized: 0 };
			const summarized = applyProactiveSummary(history, counter);
			expect(summarized).toBe(0);
		});

		it("summarizes oldest exchanges at turn 5", () => {
			const history = makeHistory([
				{ user: "Hello!", assistant: "Hi there! How can I help?" },
				{ user: "What is this?", assistant: "This is ORPHEUS, a terminal UI AI." },
				{ user: "Can you scan my system?", assistant: "Sure. Running security scan now." },
				{ user: "What did you find?", assistant: "Found 0 issues. All clear." },
				{ user: "Great, thanks!", assistant: "You're welcome. Anything else?" },
			]);
			const counter = { count: 5, summarized: 0 };
			const summarized = applyProactiveSummary(history, counter);
			expect(summarized).toBe(3);
			const summary = history.find(
				(m) => m.role === "system" && String(m.content).includes("Earlier conversation:")
			);
			expect(summary).toBeDefined();
		});

		it("preserves technical exchanges (terminal commands)", () => {
			const history = makeHistory([
				{ user: "bun run format", assistant: "Running formatting... Done." },
				{ user: "git status", assistant: "Nothing to commit, working tree clean." },
				{ user: "how are you today", assistant: "I'm doing well, thanks." },
				{ user: "thanks", assistant: "You're welcome." },
				{ user: "let's talk about features", assistant: "Sure. What features interest you?" },
			]);
			const counter = { count: 5, summarized: 0 };
			const summarized = applyProactiveSummary(history, counter);
			// "bun run format" and "git status" are detected as terminal commands (technical)
			// The remaining 3 pairs are conversational (non-technical) and should be summarized
			expect(summarized).toBe(3);
			// Verify the technical commands are NOT in the summary
			const summaryText = history.find((m) => m.role === "system")?.content as string;
			expect(summaryText).not.toContain("bun run");
			expect(summaryText).not.toContain("git status");
		});

		it("creates a summary message in history at turn 5", () => {
			const history = makeHistory([
				{ user: "What can you do", assistant: "I can help with security and coding." },
				{ user: "How about tests", assistant: "I run bun test or bun run test:watch." },
				{
					user: "Any other features",
					assistant: "I have a diff review, project doctor, and more.",
				},
				{ user: "Nice. Let's start coding", assistant: "Ready when you are. What do you need?" },
				{ user: "What time is it", assistant: "It's currently afternoon." },
			]);
			const counter = { count: 5, summarized: 0 };
			applyProactiveSummary(history, counter);
			const summary = history.find((m) => m.role === "system");
			expect(summary).toBeDefined();
			expect(summary?.content).toContain("Earlier conversation:");
		});

		it("handles empty history gracefully", () => {
			const history: ModelMessage[] = [];
			const counter = { count: 5, summarized: 0 };
			const summarized = applyProactiveSummary(history, counter);
			expect(summarized).toBe(0);
			expect(history).toEqual([]);
		});

		it("does not double-summarize", () => {
			const history = makeHistory([
				{ user: "Hey", assistant: "Hello!" },
				{ user: "What's up", assistant: "Not much. You?" },
				{ user: "Nothing", assistant: "Cool." },
				{ user: "By the way", assistant: "Yeah?" },
				{ user: "See you soon", assistant: "Take care!" },
			]);
			const counter = { count: 5, summarized: 0 };
			applyProactiveSummary(history, counter);

			// Reset counter but keep history - should not summarize again
			const counter2 = { count: 5, summarized: 0 };
			const summarized2 = applyProactiveSummary(history, counter2);
			expect(summarized2).toBe(0);
		});
	});
});
