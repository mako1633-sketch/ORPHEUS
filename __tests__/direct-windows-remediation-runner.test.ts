import { describe, expect, it } from "bun:test";
import {
	runDirectWindowsRemediation,
	shouldRunDirectWindowsRemediation,
} from "../src/ai/direct-windows-remediation-runner";
import type { ModelMessage, StreamCallbacks } from "../src/types";

describe("direct Windows remediation runner", () => {
	const remediationHistory: ModelMessage[] = [
		{
			role: "assistant",
			content:
				"**Remediation Plan**\n1. Local administrator membership needs review: Review each administrator.\n2. Listening TCP services observed: Verify each listening port.",
		},
	];

	it("routes remediation follow-ups after a remediation plan", () => {
		expect(
			shouldRunDirectWindowsRemediation(
				"Please do both of the remediation plan recommendations",
				remediationHistory
			)
		).toBe(true);
		expect(shouldRunDirectWindowsRemediation("1", remediationHistory)).toBe(true);
		expect(shouldRunDirectWindowsRemediation("option 2", remediationHistory)).toBe(true);
		expect(shouldRunDirectWindowsRemediation("1 and 2", remediationHistory)).toBe(true);
		expect(shouldRunDirectWindowsRemediation("both", remediationHistory)).toBe(true);
		expect(shouldRunDirectWindowsRemediation("all", remediationHistory)).toBe(true);
		expect(shouldRunDirectWindowsRemediation("yes please", remediationHistory)).toBe(true);
	});

	it("does not route remediation wording without prior remediation context", () => {
		expect(shouldRunDirectWindowsRemediation("Please do both recommendations", [])).toBe(false);
		expect(shouldRunDirectWindowsRemediation("1", [])).toBe(false);
	});

	it("creates a read-only review command before requesting approval", async () => {
		const events: string[] = [];
		const callbacks: StreamCallbacks = {
			onToolCall: (toolName, input) => {
				events.push(`tool:${toolName}`);
				expect(String((input as { command?: string }).command)).toContain("Get-LocalGroupMember");
				expect(String((input as { command?: string }).command)).toContain("Get-NetTCPConnection");
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
			onToolResult: (toolName) => {
				events.push(`result:${toolName}`);
			},
		};

		await runDirectWindowsRemediation(
			"Please do both of the remediation plan recommendations",
			callbacks
		);

		expect(events).toEqual(["tool:runBash", "approval:runBash", "result:runBash"]);
	});

	it("describes numeric remediation selections instead of echoing a bare number", async () => {
		let final = "";
		const callbacks: StreamCallbacks = {
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

		await runDirectWindowsRemediation("1 and 2", callbacks);

		expect(final).toContain("Remediation not applied");
		expect(final).not.toContain("fake");
	});
});
