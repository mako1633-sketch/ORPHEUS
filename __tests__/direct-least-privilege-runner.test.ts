import { describe, expect, it } from "bun:test";
import {
	runDirectLeastPrivilege,
	shouldRunDirectLeastPrivilege,
} from "../src/ai/direct-least-privilege-runner";
import { shouldRunDirectWindowsRemediation } from "../src/ai/direct-windows-remediation-runner";
import type { ModelMessage, StreamCallbacks } from "../src/types";

describe("direct least privilege runner", () => {
	const neutralHistory: ModelMessage[] = [
		{ role: "assistant", content: "We should tighten Windows security carefully." },
	];

	const remediationHistory: ModelMessage[] = [
		{
			role: "assistant",
			content:
				"**Remediation Plan**\n1. Local administrator membership needs review.\n2. Listening TCP services observed.",
		},
	];

	it("answers least-privilege discussion directly without search or fake tool JSON", () => {
		expect(
			shouldRunDirectLeastPrivilege(
				'Well, that is good. We want to employ the "principle of least priviledge", no?',
				neutralHistory
			)
		).toBe(true);
	});

	it("lets least-privilege remediation after findings use the remediation workflow", () => {
		expect(
			shouldRunDirectWindowsRemediation(
				"Apply the principle of least privilege to those recommendations",
				remediationHistory
			)
		).toBe(true);
		expect(
			shouldRunDirectLeastPrivilege(
				"Apply the principle of least privilege to those recommendations",
				remediationHistory
			)
		).toBe(false);
	});

	it("explains least privilege in normal chat", async () => {
		let final = "";
		const callbacks: StreamCallbacks = {
			onComplete: (text) => {
				final = text;
			},
		};

		await runDirectLeastPrivilege("What is least privilege?", callbacks);

		expect(final).toContain(
			"give each account, service, app, and network path only the access it needs"
		);
		expect(final).not.toContain('"action"');
		expect(final).not.toContain("webSearch");
	});
});
