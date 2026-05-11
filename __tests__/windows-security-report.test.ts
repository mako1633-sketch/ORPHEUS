import { describe, expect, it } from "bun:test";
import type { AssessmentFinding } from "../src/security/windows-assessment-parser";
import { buildWindowsRemediationPlan } from "../src/security/windows-remediation";
import { buildWindowsSecurityReport, categoryForFinding } from "../src/security/windows-security-report";

describe("Windows security report", () => {
	it("categorizes findings for score breakdowns", () => {
		expect(categoryForFinding({ id: "defender-disabled", title: "Defender disabled" })).toBe("Defender");
		expect(categoryForFinding({ id: "firewall-inbound-allow", title: "Inbound allows traffic" })).toBe(
			"Firewall"
		);
		expect(categoryForFinding({ id: "admin-membership-review", title: "Local admins" })).toBe("Accounts");
	});

	it("builds a marketable snapshot report with score, controls, questions, and prompts", () => {
		const findings: AssessmentFinding[] = [
			{
				id: "defender-realtime-disabled",
				title: "Defender real-time protection appears disabled",
				severity: "high",
				evidence: "RealTimeProtectionEnabled : False",
				risk: "Without real-time scanning, malicious files may execute before detection.",
				remediation: "Turn real-time protection back on.",
				confidence: "high",
			},
			{
				id: "admin-membership-review",
				title: "Local administrator membership needs review",
				severity: "medium",
				evidence: "Administrators contains several entries.",
				risk: "Extra local admins increase blast radius.",
				remediation: "Review each administrator and remove stale entries.",
				confidence: "medium",
			},
		];

		const report = buildWindowsSecurityReport(findings, buildWindowsRemediationPlan(findings));

		expect(report.score).toBeLessThan(100);
		expect(report.risk).toBe("Medium");
		expect(report.breakdown.some((item) => item.category === "Defender")).toBe(true);
		expect(report.cyberReadinessControls.some((control) => control.id === "mfa")).toBe(true);
		expect(report.questionnairePrompts.length).toBeGreaterThan(0);
		expect(report.promptSuggestions.some((suggestion) => suggestion.label === "Client email")).toBe(true);
		expect(report.markdown).toContain("ORPHEUS Security Snapshot");
		expect(report.markdown).toContain("Cyber Readiness Controls");
	});
});
