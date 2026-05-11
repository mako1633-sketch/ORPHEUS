import { describe, expect, it } from "bun:test";
import {
	buildWindowsSecurityPlaybookCommand,
	getWindowsSecurityPlaybook,
	listWindowsSecurityPlaybooks,
} from "../src/security/windows-security-playbooks";

describe("Windows security playbooks", () => {
	it("lists vetted read-only playbooks", () => {
		const playbooks = listWindowsSecurityPlaybooks();

		expect(playbooks.length).toBeGreaterThanOrEqual(6);
		expect(playbooks.map((playbook) => playbook.id)).toContain("quickPosture");
		expect(playbooks.map((playbook) => playbook.id)).toContain("securitySignalsReview");
		expect(playbooks.map((playbook) => playbook.id)).toContain("fullReadOnlyAssessment");
		expect(playbooks.every((playbook) => playbook.riskLevel === "read-only")).toBe(true);
	});

	it("builds commands from real built-in PowerShell checks", () => {
		const command = buildWindowsSecurityPlaybookCommand("quickPosture");

		expect(command).toContain("Get-ComputerInfo");
		expect(command).toContain("Get-HotFix");
		expect(command).toContain("Get-MpComputerStatus");
		expect(command).toContain("Get-NetFirewallProfile");
		expect(command).not.toContain("Get-WindowsVulnerabilityReport");
		expect(command).not.toContain("Set-MpPreference");
		expect(command).not.toContain("Remove-Item");
	});

	it("includes evidence descriptions for assessment reporting", () => {
		const playbook = getWindowsSecurityPlaybook("suspiciousProcessTriage");

		expect(playbook.checks.length).toBeGreaterThan(0);
		expect(playbook.checks.every((check) => check.why.length > 0)).toBe(true);
		expect(playbook.checks.map((check) => check.id)).toContain("recentSecurityEvents");
	});

	it("includes a focused security signals review playbook", () => {
		const playbook = getWindowsSecurityPlaybook("securitySignalsReview");
		const checkIds = playbook.checks.map((check) => check.id);

		expect(checkIds).toContain("defender");
		expect(checkIds).toContain("firewallProfiles");
		expect(checkIds).toContain("startupItems");
		expect(checkIds).toContain("services");
		expect(checkIds).toContain("listeningPorts");
		expect(checkIds).toContain("recentSecurityEvents");
	});
});
