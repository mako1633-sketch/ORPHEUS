import { describe, expect, it } from "bun:test";
import { AgentTurnRunner } from "../src/ai/agent-turn-runner";
import {
	runDirectPatchManagement,
	shouldRunDirectPatchManagement,
} from "../src/ai/direct-patch-management-runner";
import type { ModelMessage, StreamCallbacks } from "../src/types";

describe("direct patch management runner", () => {
	it("answers patch automation questions without fake tool JSON", async () => {
		let final = "";
		let toolCalls = 0;
		const callbacks: StreamCallbacks = {
			onComplete: (text) => {
				final = text;
			},
			onToolCall: () => {
				toolCalls++;
			},
		};

		expect(
			shouldRunDirectPatchManagement("Help me with patch management. How much can you automate?")
		).toBe(true);
		await runDirectPatchManagement(
			"Help me with patch management. How much can you automate?",
			[],
			callbacks
		);

		expect(final).toContain("I can automate patch management in three layers");
		expect(final).toContain("No settings change until you approve");
		expect(final).not.toContain('"action"');
		expect(final).not.toContain("windowsSecurity API");
		expect(toolCalls).toBe(0);
	});

	it("routes a follow-up 'well?' after patch context away from the model", async () => {
		let final = "";
		let toolCalls = 0;
		const runner = new AgentTurnRunner();
		const history: ModelMessage[] = [
			{
				role: "assistant",
				content:
					'{"action":"parse","save":true} for action and playbook "patchPosture" in windowsSecurity API call to fetch data.',
			},
		];

		await runner.run(
			{
				userText: "well?",
				conversationHistory: history,
				interactionMode: "text",
				reasoningEffort: "medium",
				platform: "win32",
			},
			{
				onComplete: (text) => {
					final = text;
				},
				onToolCall: () => {
					toolCalls++;
				},
			}
		);

		expect(final).toContain("Concrete answer");
		expect(final).toContain("approval-gated");
		expect(final).not.toContain('"action"');
		expect(toolCalls).toBe(0);
	});
});
