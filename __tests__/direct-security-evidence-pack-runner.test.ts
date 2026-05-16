import { describe, expect, it } from "bun:test";
import { AgentTurnRunner } from "../src/ai/agent-turn-runner";
import {
	runDirectSecurityEvidencePack,
	shouldRunDirectSecurityEvidencePack,
} from "../src/ai/direct-security-evidence-pack-runner";
import type { StreamCallbacks } from "../src/types";

describe("direct security evidence pack runner", () => {
	it("routes explicit client evidence pack prompts", () => {
		expect(
			shouldRunDirectSecurityEvidencePack("Create a Managed Security Evidence Pack for Acme.")
		).toBe(true);
		expect(shouldRunDirectSecurityEvidencePack("Run client evidence pack for Acme")).toBe(true);
		expect(shouldRunDirectSecurityEvidencePack("What is an evidence pack?")).toBe(false);
	});

	it("asks approval before read-only evidence collection", async () => {
		const events: string[] = [];
		let final = "";
		const callbacks: StreamCallbacks = {
			onToolCall: (toolName) => {
				events.push(`tool:${toolName}`);
			},
			onToolApprovalRequest: (request) => {
				events.push(`approval:${request.toolName}`);
			},
			onAwaitingApprovals: (requests, respond) => {
				respond(
					requests.map((request) => ({
						approvalId: request.approvalId,
						approved: false,
						reason: "test denial",
					}))
				);
			},
			onComplete: (text) => {
				final = text;
			},
		};

		await runDirectSecurityEvidencePack(
			"Create a Managed Security Evidence Pack for Acme.",
			callbacks
		);

		expect(events).toContain("tool:windowsSecurity");
		expect(events).toContain("tool:runBash");
		expect(events).toContain("approval:runBash");
		expect(final).toContain("Evidence pack not created");
		expect(final).toContain("test denial");
	});

	it("routes through the agent runner without generic model chatter", async () => {
		const runner = new AgentTurnRunner();
		let final = "";
		let windowsSecurityCalls = 0;

		await runner.run(
			{
				userText: "Run client evidence pack for Acme",
				conversationHistory: [],
				interactionMode: "text",
				reasoningEffort: "medium",
				platform: "win32",
			},
			{
				onToolCall: (toolName) => {
					if (toolName === "windowsSecurity") windowsSecurityCalls++;
				},
				onAwaitingApprovals: (requests, respond) => {
					respond(
						requests.map((request) => ({
							approvalId: request.approvalId,
							approved: false,
							reason: "test denial",
						}))
					);
				},
				onComplete: (text) => {
					final = text;
				},
			}
		);

		expect(windowsSecurityCalls).toBe(1);
		expect(final).toContain("Evidence pack not created");
	});
});
