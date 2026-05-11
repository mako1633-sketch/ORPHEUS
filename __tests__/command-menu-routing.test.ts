import { describe, expect, it } from "bun:test";
import { shouldRunDirectDaemonDoctor } from "../src/ai/direct-daemon-doctor-runner";
import { shouldRunDirectSecurityEvidencePack } from "../src/ai/direct-security-evidence-pack-runner";
import {
	shouldRunDirectWindowsAssessment,
	shouldRunDirectWindowsQuickPosture,
	shouldRunDirectWindowsSecurityReview,
	shouldRunDirectWindowsSecuritySnapshot,
} from "../src/ai/direct-windows-assessment-runner";
import { getStartupActions } from "../src/ui/startup-actions";

function actionPrompt(label: string): string {
	const action = getStartupActions("win32").find((item) => item.label === label);
	if (!action) throw new Error(`Missing startup action: ${label}`);
	return action.prompt;
}

describe("command menu routing", () => {
	it("routes executable startup actions away from model-authored fake tool JSON", () => {
		expect(
			shouldRunDirectSecurityEvidencePack(actionPrompt("Evidence Pack: client-ready assessment bundle"))
		).toBe(true);
		expect(
			shouldRunDirectDaemonDoctor(actionPrompt("ORPHEUS Doctor: keys, tools, PowerShell, Signal, search"))
		).toBe(true);
		expect(
			shouldRunDirectWindowsSecuritySnapshot(actionPrompt("Blackwall Snapshot: score, findings, fix plan"))
		).toBe(true);
		expect(shouldRunDirectWindowsQuickPosture(actionPrompt("Quick Scan: posture pulse"))).toBe(true);
		expect(shouldRunDirectWindowsAssessment(actionPrompt("Full Audit: evidence dive"))).toBe(true);
		expect(
			shouldRunDirectWindowsSecurityReview(
				actionPrompt("Signal Sweep: Defender, firewall, services, ports, logs")
			)
		).toBe(true);
	});

	it("keeps context-seeking startup actions out of deterministic tool execution", () => {
		const prompts = [
			actionPrompt("Crash Forensics: setup errors and app faults"),
			actionPrompt("Codejack: inspect and edit project files"),
			actionPrompt("PowerShell Probe: approved read-only commands"),
			actionPrompt("Netwatch: search current sources"),
		];

		for (const prompt of prompts) {
			expect(shouldRunDirectDaemonDoctor(prompt)).toBe(false);
			expect(shouldRunDirectWindowsSecuritySnapshot(prompt)).toBe(false);
			expect(shouldRunDirectWindowsQuickPosture(prompt)).toBe(false);
			expect(shouldRunDirectWindowsAssessment(prompt)).toBe(false);
			expect(shouldRunDirectWindowsSecurityReview(prompt)).toBe(false);
		}
	});
});
