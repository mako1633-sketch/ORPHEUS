import { describe, expect, it } from "bun:test";
import type { ModelMessage } from "ai";
import { extractFinalAssistantText } from "../src/ai/message-utils";

describe("message utils", () => {
	it("extracts final assistant text from string content", () => {
		const messages: ModelMessage[] = [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Plain assistant answer" },
		];

		expect(extractFinalAssistantText(messages)).toBe("Plain assistant answer");
	});
});
