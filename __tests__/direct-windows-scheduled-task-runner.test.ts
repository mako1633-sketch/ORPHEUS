import { describe, expect, it } from "bun:test";
import { AgentTurnRunner } from "../src/ai/agent-turn-runner";
import {
	runDirectWindowsScheduledTaskSecurity,
	shouldRunDirectWindowsScheduledTaskSecurity,
} from "../src/ai/direct-windows-scheduled-task-runner";
import type { StreamCallbacks } from "../src/types";

describe("direct Windows scheduled task runner", () => {
	it("routes security scheduled task create and modify prompts", () => {
		expect(
			shouldRunDirectWindowsScheduledTaskSecurity(
				"Create a scheduled task for daily Defender security scans."
			)
		).toBe(true);
		expect(
			shouldRunDirectWindowsScheduledTaskSecurity("Modify the security scheduled task for weekly full scan.")
		).toBe(true);
		expect(shouldRunDirectWindowsScheduledTaskSecurity("What are scheduled tasks?")).toBe(false);
	});

	it("builds a windowsHardening plan and asks approval before changing tasks", async () => {
		const events: string[] = [];
		const commands: string[] = [];
		const callbacks: StreamCallbacks = {
			onToolCall: (toolName, input) => {
				events.push(`tool:${toolName}`);
				if (toolName === "runBash" && input && typeof input === "object" && "command" in input) {
					commands.push(String(input.command));
				}
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
		};

		await runDirectWindowsScheduledTaskSecurity(
			"Create a scheduled task for daily Defender security scans.",
			callbacks
		);

		expect(events).toContain("tool:windowsHardening");
		expect(events).toContain("tool:runBash");
		expect(events).toContain("approval:runBash");
		expect(commands.some((command) => command.includes("Register-ScheduledTask"))).toBe(true);
		expect(commands.some((command) => command.includes("\\ORPHEUS\\Security\\"))).toBe(true);
	});

	it("routes through the agent runner without calling the generic model", async () => {
		let final = "";
		let hardeningCalls = 0;
		const runner = new AgentTurnRunner();

		await runner.run(
			{
				userText: "Create a scheduled task for daily Defender quick scans.",
				conversationHistory: [],
				interactionMode: "text",
				reasoningEffort: "medium",
				platform: "win32",
			},
			{
				onToolCall: (toolName) => {
					if (toolName === "windowsHardening") hardeningCalls++;
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

		expect(hardeningCalls).toBe(1);
		expect(final).toContain("Scheduled task change not applied");
		expect(final).toContain("defenderQuickScanDaily");
	});
});
