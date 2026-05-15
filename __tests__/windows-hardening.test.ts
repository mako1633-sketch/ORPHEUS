import { describe, expect, it } from "bun:test";
import { listWindowsEventTriageQueries } from "../src/security/windows-event-triage";
import {
	WINDOWS_HARDENING_RULES,
	getWindowsHardeningRulesForProfile,
	listWindowsHardeningProfiles,
} from "../src/security/windows-hardening-baselines";
import {
	buildHardeningCheckCommand,
	buildPolicyCheckCommand,
	buildWindowsHardeningPlan,
} from "../src/security/windows-hardening-planner";
import { scoreWindowsProcess } from "../src/security/windows-process-scoring";
import {
	buildWindowsSecurityScheduledTaskPlan,
	listWindowsSecurityScheduledTaskTemplates,
} from "../src/security/windows-scheduled-tasks";
import { listWindowsWatchRules } from "../src/security/windows-watch-rules";

describe("Windows hardening baselines", () => {
	it("defines named hardening profiles with baseline rules", () => {
		const profiles = listWindowsHardeningProfiles();

		expect(profiles.map((profile) => profile.id)).toContain("developerWorkstation");
		expect(profiles.map((profile) => profile.id)).toContain("highSecurityLaptop");
		expect(getWindowsHardeningRulesForProfile("developerWorkstation").length).toBeGreaterThan(3);
		expect(WINDOWS_HARDENING_RULES["defender-realtime-on"]?.rollbackCommand).toContain("Set-MpPreference");
	});

	it("builds policy-aware plans with rollback commands", () => {
		const plan = buildWindowsHardeningPlan("smallBusinessEndpoint");

		expect(plan.items.length).toBeGreaterThan(0);
		expect(plan.items.every((item) => item.requiresApproval)).toBe(true);
		expect(plan.items.every((item) => item.policyCheckCommand.length > 0)).toBe(true);
		expect(plan.items.every((item) => item.rollbackCommand.length > 0)).toBe(true);
		expect(plan.summary["needs-admin"]).toBeGreaterThan(0);
	});

	it("builds separate check and policy commands", () => {
		const check = buildHardeningCheckCommand("homeWorkstation");
		const policy = buildPolicyCheckCommand("homeWorkstation");

		expect(check).toContain("Get-MpComputerStatus");
		expect(policy).toContain("### Policy:");
		expect(check).not.toContain("Set-MpPreference");
	});

	it("lists watch and event triage rules", () => {
		expect(listWindowsWatchRules().map((rule) => rule.id)).toContain("watch-new-local-admin");
		expect(listWindowsEventTriageQueries().map((query) => query.id)).toContain("defender-detections");
	});

	it("scores suspicious process signals", () => {
		const score = scoreWindowsProcess({
			name: "weird.exe",
			path: "C:\\Users\\matt-\\AppData\\Local\\Temp\\weird.exe",
			signed: false,
			listeningPort: 4444,
			runsAsAdmin: true,
			parentProcess: "winword.exe",
		});

		expect(score.severity).toBe("high");
		expect(score.reasons.length).toBeGreaterThan(2);
	});

	it("builds approval-ready defensive scheduled task plans", () => {
		const templates = listWindowsSecurityScheduledTaskTemplates();
		const plan = buildWindowsSecurityScheduledTaskPlan("create", "defenderQuickScanDaily");

		expect(templates.map((template) => template.id)).toContain("defenderQuickScanDaily");
		expect(plan.requiresApproval).toBe(true);
		expect(plan.template.taskPath).toBe("\\ORPHEUS\\Security\\");
		expect(plan.command).toContain("Register-ScheduledTask");
		expect(plan.command).toContain("Start-MpScan -ScanType QuickScan");
		expect(plan.rollbackCommand).toContain("Disable-ScheduledTask");
	});
});
