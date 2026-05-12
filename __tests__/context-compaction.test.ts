import { describe, expect, test } from "bun:test";
import { compactModelHistoryForContext } from "../src/ai/context-compaction";
import type { ModelMessage } from "../src/types";

describe("context compaction", () => {
	test("drops raw tool payloads and keeps recent text inside a budget", () => {
		const hugeOutput = "x".repeat(5000);
		const messages: ModelMessage[] = [
			{ role: "user", content: "Please inspect the project." },
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call_1",
						toolName: "projectContext",
						input: { root: "/tmp/project" },
					},
				],
			} as ModelMessage,
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "projectContext",
						output: { type: "json", value: { files: [hugeOutput] } },
					},
				],
			} as ModelMessage,
			{ role: "assistant", content: `I found the issue.\n${hugeOutput}` },
			{ role: "user", content: "What happened?" },
		];

		const compacted = compactModelHistoryForContext(messages, {
			maxContextChars: 1200,
			maxMessageChars: 300,
		});
		const serialized = JSON.stringify(compacted);

		expect(serialized.length).toBeLessThan(1600);
		expect(serialized).toContain("What happened?");
		expect(serialized).toContain("I found the issue.");
		expect(serialized).not.toContain(hugeOutput);
		expect(compacted.every((message) => message.role !== "tool")).toBe(true);
	});

	test("adds a compaction note when older messages are omitted", () => {
		const messages: ModelMessage[] = Array.from({ length: 20 }, (_, index) => ({
			role: index % 2 === 0 ? "user" : "assistant",
			content: `message-${index} ${"a".repeat(100)}`,
		})) as ModelMessage[];

		const compacted = compactModelHistoryForContext(messages, {
			maxContextChars: 800,
			maxMessageChars: 200,
		});

		expect(compacted[0]?.role).toBe("assistant");
		expect(String(compacted[0]?.content)).toContain("Earlier conversation compacted");
		expect(JSON.stringify(compacted)).toContain("message-19");
	});
});
