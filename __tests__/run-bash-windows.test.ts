import { describe, expect, it } from "bun:test";

import {
	buildNonInteractiveShellEnv,
	getLocalShellCommand,
	getWindowsPowerShellPath,
} from "../src/ai/tools/run-bash";
import {
	classifyCommandRisk,
	getBlockedCommandReason,
	isDangerousCommand,
	isSensitivePathAccess,
} from "../src/security/bash-security-policy";

describe("local shell command execution", () => {
	it("uses PowerShell on Windows", () => {
		const shell = getLocalShellCommand("Get-ChildItem", "win32");

		expect(shell.name).toBe("powershell");
		expect(shell.command).toEndWith("\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
		expect(shell.args).toContain("-NoLogo");
		expect(shell.args).toContain("-NoProfile");
		expect(shell.args).toContain("-NonInteractive");
		expect(shell.args).not.toContain("-ExecutionPolicy");
		expect(shell.args).not.toContain("Bypass");
		expect(shell.args.at(-1)).toBe("Get-ChildItem");
	});

	it("uses SystemRoot for the Windows PowerShell path", () => {
		expect(getWindowsPowerShellPath({ SystemRoot: "D:\\Win" })).toBe(
			"D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
		);
		expect(getWindowsPowerShellPath({})).toBe(
			"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
		);
	});

	it("uses bash on non-Windows platforms", () => {
		const shell = getLocalShellCommand("ls -la", "linux");

		expect(shell.name).toBe("bash");
		expect(shell.command).toBe("bash");
		expect(shell.args).toEqual(["-c", "ls -la"]);
	});

	it("disables interactive auth prompts for background shell commands", () => {
		const env = buildNonInteractiveShellEnv({});

		expect(env.CI).toBe("1");
		expect(env.GIT_TERMINAL_PROMPT).toBe("0");
		expect(env.GIT_ASKPASS).toBe("/usr/bin/false");
		expect(env.SSH_ASKPASS).toBe("/usr/bin/false");
		expect(env.SUDO_ASKPASS).toBe("/usr/bin/false");
	});
});

describe("Windows command safety policy", () => {
	it("flags PowerShell recursive deletion", () => {
		expect(isDangerousCommand("Remove-Item C:\\Temp\\thing -Recurse -Force")).toBe(true);
	});

	it("flags Windows credential and browser data paths", () => {
		expect(
			isSensitivePathAccess(
				"Get-Content ~\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cookies"
			)
		).toBe(true);
	});

	it("flags environment variable enumeration", () => {
		expect(isDangerousCommand("Get-ChildItem Env:")).toBe(true);
	});

	it("does not flag benign PowerShell formatting as disk formatting", () => {
		expect(isDangerousCommand("Get-ChildItem | Format-Table -AutoSize")).toBe(false);
	});

	it("blocks runaway Linux monitor loops with forced process kills", () => {
		const command = "while true; do date; killall -9 bash; sleep 60; done";
		expect(getBlockedCommandReason(command)).toBeString();
	});

	it("blocks forced Windows process termination", () => {
		expect(getBlockedCommandReason("taskkill /f /im powershell.exe")).toBeString();
		expect(getBlockedCommandReason("Stop-Process -Name powershell -Force")).toBeString();
	});

	it("blocks Windows credential dumping patterns", () => {
		expect(
			getBlockedCommandReason(
				"rundll32.exe C:\\Windows\\System32\\comsvcs.dll, MiniDump 123 lsass.dmp full"
			)
		).toBeString();
		expect(getBlockedCommandReason("reg save HKLM\\SAM C:\\Temp\\sam.save")).toBeString();
		expect(isSensitivePathAccess("Get-Content C:\\Windows\\System32\\config\\SAM")).toBe(true);
	});

	it("blocks attempts to weaken Windows protections", () => {
		expect(
			getBlockedCommandReason("Set-MpPreference -DisableRealtimeMonitoring $true")
		).toBeString();
		expect(getBlockedCommandReason("netsh advfirewall set allprofiles state off")).toBeString();
		expect(getBlockedCommandReason("powershell.exe -EncodedCommand SQBFAFgA")).toBeString();
	});

	it("allows approved remediation commands that re-enable Windows protections", () => {
		expect(
			getBlockedCommandReason("Set-MpPreference -DisableRealtimeMonitoring $false")
		).toBeNull();
		expect(
			getBlockedCommandReason("Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True")
		).toBeNull();
	});

	it("classifies command risk for approval context", () => {
		expect(classifyCommandRisk("Get-MpComputerStatus").level).toBe("read-only");
		expect(classifyCommandRisk("Get-ChildItem Env:").level).toBe("modifies-system");
		expect(
			classifyCommandRisk(
				"Get-Content ~\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cookies"
			).level
		).toBe("sensitive-read");
		expect(classifyCommandRisk("Stop-Process -Name powershell -Force").level).toBe("blocked");
	});
});
