import { describe, expect, it } from "bun:test";
import {
	runDirectWindowsSecurityReview,
	runDirectWindowsAssessment,
	shouldRunDirectWindowsSecuritySnapshot,
	shouldRunDirectWindowsAssessment,
	shouldRunDirectWindowsQuickPosture,
	shouldRunDirectWindowsSecurityReview,
} from "../src/ai/direct-windows-assessment-runner";
import type { ModelMessage, StreamCallbacks } from "../src/types";

describe("direct Windows assessment runner", () => {
	it("routes clear full local Windows assessment prompts to deterministic execution", () => {
		expect(
			shouldRunDirectWindowsAssessment(
				"Run a full read-only Windows security assessment on this device and structure the findings."
			)
		).toBe(true);
	});

	it("routes Security Snapshot prompts to deterministic execution", () => {
		expect(
			shouldRunDirectWindowsSecuritySnapshot(
				"Run an ORPHEUS Security Snapshot with a score and cyber-readiness report."
			)
		).toBe(true);
		expect(
			shouldRunDirectWindowsAssessment(
				"Run an ORPHEUS Security Snapshot with a score and cyber-readiness report."
			)
		).toBe(true);
	});

	it("routes approval follow-ups when the prior assistant proposed the assessment playbook", () => {
		const history: ModelMessage[] = [
			{
				role: "assistant",
				content:
					"I will retrieve the fullReadOnlyAssessment playbook and ask approval for the read-only command bundle.",
			},
		];

		expect(shouldRunDirectWindowsAssessment("Please proceed with the assessment", history)).toBe(true);
	});

	it("leaves unrelated prompts with the normal model path", () => {
		expect(shouldRunDirectWindowsAssessment("Explain what Defender does.")).toBe(false);
	});

	it("leaves conversational assessment questions on the normal model path", () => {
		expect(shouldRunDirectWindowsSecuritySnapshot("What is an ORPHEUS Security Snapshot?")).toBe(false);
		expect(shouldRunDirectWindowsSecuritySnapshot("How does cyber readiness scoring work?")).toBe(false);
		expect(shouldRunDirectWindowsQuickPosture("What is a quick Windows posture scan?")).toBe(false);
		expect(shouldRunDirectWindowsAssessment("What is a full Windows security assessment?")).toBe(false);
		expect(
			shouldRunDirectWindowsSecurityReview("What are Defender, firewall, startup, services, ports, and logs?")
		).toBe(false);
	});

	it("routes quick posture prompts to deterministic execution", () => {
		expect(shouldRunDirectWindowsQuickPosture("Run a quick Windows security posture playbook")).toBe(true);
		expect(shouldRunDirectWindowsQuickPosture("Run a full read-only Windows security assessment")).toBe(
			false
		);
	});

	it("routes Defender firewall services ports and logs review prompts to deterministic execution", () => {
		expect(
			shouldRunDirectWindowsSecurityReview(
				"Review Defender, firewall, startup items, services, listening ports, and recent security event signals."
			)
		).toBe(true);
	});

	it("does not rerun assessment when the user asks to enact the remediation plan", () => {
		const history: ModelMessage[] = [
			{
				role: "assistant",
				content:
					"Completed the full read-only Windows security assessment.\n\n**Remediation Plan**\n1. Enable Defender protection: Approval required before changes.",
			},
		];

		expect(
			shouldRunDirectWindowsAssessment("Please enact the remediation plan you suggested.", history)
		).toBe(false);
	});

	it("creates the runBash tool call before requesting approval", async () => {
		const events: string[] = [];
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
			onToolResult: (toolName) => {
				events.push(`result:${toolName}`);
			},
		};

		await runDirectWindowsAssessment(
			"Run a full read-only Windows security assessment on this device and structure the findings.",
			callbacks
		);

		expect(events).toContain("tool:runBash");
		expect(events).toContain("approval:runBash");
		expect(events.indexOf("tool:runBash")).toBeLessThan(events.indexOf("approval:runBash"));
		expect(events).toContain("result:runBash");
	});

	it("uses the focused security signals playbook for Defender firewall ports and logs review", async () => {
		const toolInputs: unknown[] = [];
		const callbacks: StreamCallbacks = {
			onToolCall: (toolName, input) => {
				if (toolName === "windowsSecurity") toolInputs.push(input);
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

		await runDirectWindowsSecurityReview(
			"Review Defender, firewall, startup items, services, listening ports, and recent security event signals.",
			callbacks
		);

		expect(toolInputs).toContainEqual({ action: "get", playbook: "securitySignalsReview" });
	});
});
