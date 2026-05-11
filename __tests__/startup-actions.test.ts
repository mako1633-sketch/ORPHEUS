import { describe, expect, it } from "bun:test";
import {
	STARTUP_COMMON_ACTIONS,
	getStartupActions,
	getStartupActionForInput,
	getStartupActionForKey,
} from "../src/ui/startup-actions";

describe("startup common actions", () => {
	it("lists practical actions for a new macOS/Linux session", () => {
		const actions = getStartupActions("darwin");
		expect(actions.length).toBeGreaterThanOrEqual(5);
		const labels = actions.map((action) => action.label);
		expect(labels).toContain("Mac Checkup: keys, tools, shell, Signal, search");
		expect(labels).toContain("Workspace Scan: project and setup health");
		expect(labels).toContain("Shell Probe: approved read-only commands");
		expect(labels).toContain("Crash Forensics: setup errors and app faults");
		expect(actions.every((action) => action.prompt.length > 0)).toBe(true);
		expect(actions.every((action) => action.description && action.description.length > 0)).toBe(true);
	});

	it("keeps Windows-focused actions on Windows", () => {
		const actions = getStartupActions("win32");
		const labels = actions.map((action) => action.label);
		expect(labels).toContain("Evidence Pack: client-ready assessment bundle");
		expect(labels).toContain("ORPHEUS Doctor: keys, tools, PowerShell, Signal, search");
		expect(labels).toContain("Blackwall Snapshot: score, findings, fix plan");
		expect(labels).toContain("Quick Scan: posture pulse");
		expect(labels).toContain("PowerShell Probe: approved read-only commands");
	});

	it("maps number keys to startup action prompts", () => {
		expect(getStartupActionForKey("1")?.prompt).toBe(STARTUP_COMMON_ACTIONS[0]?.prompt);
		expect(getStartupActionForKey("2")?.prompt).toBe(STARTUP_COMMON_ACTIONS[1]?.prompt);
		expect(getStartupActionForKey("9")?.prompt).toBe(STARTUP_COMMON_ACTIONS[8]?.prompt);
		expect(getStartupActionForKey("x")).toBeNull();
	});

	it("maps typed run commands to startup action prompts", () => {
		expect(getStartupActionForInput("run 3")?.prompt).toBe(STARTUP_COMMON_ACTIONS[2]?.prompt);
		expect(getStartupActionForInput("Run option 4.")?.prompt).toBe(STARTUP_COMMON_ACTIONS[3]?.prompt);
		expect(getStartupActionForInput("3", { allowBareNumber: true })?.prompt).toBe(
			STARTUP_COMMON_ACTIONS[2]?.prompt
		);
		expect(getStartupActionForInput("3")).toBeNull();
		expect(getStartupActionForInput("run a security audit")).toBeNull();
	});
});
