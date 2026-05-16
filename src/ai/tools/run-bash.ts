import { spawn } from "node:child_process";
import { tool } from "ai";
import { z } from "zod";
import {
	getBlockedCommandReason,
	isDangerousCommand,
	isSensitivePathAccess,
} from "../../security/bash-security-policy";

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_OUTPUT_LENGTH = 50000;
const DISABLED_ASKPASS = "/usr/bin/false";
const AUTH_PROMPT_REDACTION = "[interactive auth prompt suppressed]";

export type LocalShell = {
	name: "powershell" | "bash";
	command: string;
	args: string[];
};

export function getWindowsPowerShellPath(env: NodeJS.ProcessEnv = process.env): string {
	const systemRoot = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
	return `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

export function getLocalShellCommand(command: string, platform = process.platform): LocalShell {
	if (platform === "win32") {
		return {
			name: "powershell",
			command: getWindowsPowerShellPath(),
			args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
		};
	}

	return {
		name: "bash",
		command: "bash",
		args: ["-c", command],
	};
}

export function buildNonInteractiveShellEnv(
	env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
	return {
		...env,
		CI: env.CI ?? "1",
		GIT_ASKPASS: env.GIT_ASKPASS ?? DISABLED_ASKPASS,
		GIT_TERMINAL_PROMPT: "0",
		SSH_BATCH_MODE: env.SSH_BATCH_MODE ?? "yes",
		NPM_CONFIG_AUDIT: env.NPM_CONFIG_AUDIT ?? "false",
		NPM_CONFIG_FUND: env.NPM_CONFIG_FUND ?? "false",
		SUDO_ASKPASS: env.SUDO_ASKPASS ?? DISABLED_ASKPASS,
		SSH_ASKPASS: env.SSH_ASKPASS ?? DISABLED_ASKPASS,
	};
}

export function sanitizeShellOutput(output: string): string {
	return output
		.replace(/(\[sudo\]\s*)?password(?:\s+for\s+[^:\r\n]+)?\s*:/gi, AUTH_PROMPT_REDACTION)
		.replace(
			/(?:enter\s+)?passphrase(?:\s+for\s+key\s+['"][^'"]+['"])?\s*:/gi,
			AUTH_PROMPT_REDACTION
		);
}

export async function executeLocalShellCommand({
	command,
	workdir,
	timeout,
}: {
	command: string;
	workdir?: string;
	timeout?: number;
}) {
	const blockedReason = getBlockedCommandReason(command);
	if (blockedReason) {
		return {
			success: false,
			exitCode: null,
			shell: getLocalShellCommand(command).name,
			stdout: "",
			stderr: "",
			error: blockedReason,
		};
	}

	return new Promise<{
		success: boolean;
		exitCode: number | null;
		shell: LocalShell["name"];
		stdout: string;
		stderr: string;
		error?: string;
	}>((resolve) => {
		const cwd = workdir || process.cwd();
		const shell = getLocalShellCommand(command);
		let stdout = "";
		let stderr = "";
		let killed = false;

		const proc = spawn(shell.command, shell.args, {
			cwd,
			env: buildNonInteractiveShellEnv(),
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});

		const timeoutId = setTimeout(() => {
			killed = true;
			proc.kill(process.platform === "win32" ? undefined : "SIGKILL");
		}, timeout || DEFAULT_TIMEOUT_MS);

		proc.stdout.on("data", (data: Buffer) => {
			stdout += data.toString();
		});

		proc.stderr.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			clearTimeout(timeoutId);

			if (stdout.length > MAX_OUTPUT_LENGTH) {
				stdout = `${stdout.slice(0, MAX_OUTPUT_LENGTH)}\n... [output truncated]`;
			}
			if (stderr.length > MAX_OUTPUT_LENGTH) {
				stderr = `${stderr.slice(0, MAX_OUTPUT_LENGTH)}\n... [output truncated]`;
			}
			stdout = sanitizeShellOutput(stdout);
			stderr = sanitizeShellOutput(stderr);

			if (killed) {
				resolve({
					success: false,
					exitCode: null,
					shell: shell.name,
					stdout: stdout.trim(),
					stderr: stderr.trim(),
					error: `Command timed out after ${timeout || DEFAULT_TIMEOUT_MS}ms`,
				});
			} else {
				resolve({
					success: code === 0,
					exitCode: code,
					shell: shell.name,
					stdout: stdout.trim(),
					stderr: stderr.trim(),
				});
			}
		});

		proc.on("error", (error) => {
			clearTimeout(timeoutId);
			resolve({
				success: false,
				exitCode: null,
				shell: shell.name,
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				error: error instanceof Error ? error.message : String(error),
			});
		});
	});
}

export const runBash = tool({
	description:
		"Execute a local shell command on the user's system. On Windows this uses PowerShell; on macOS/Linux this uses bash. Use this for approved local system inspection, including Windows security posture checks such as Windows Update hotfix/build status, Microsoft Defender status via Get-MpComputerStatus, firewall profiles via Get-NetFirewallProfile, startup items, services, scheduled tasks, listening ports, and installed software metadata. Prefer finite read-only commands. Do not invent cmdlets such as Get-WindowsVulnerabilityReport; use built-in read-only PowerShell commands that exist on Windows. Commands run in the current working directory by default.",
	inputSchema: z.object({
		description: z
			.string()
			.describe(
				"A brief description (5-10 words) of what this command does, so the user understands the purpose."
			),
		command: z
			.string()
			.describe(
				"The shell command to execute. Use PowerShell syntax on Windows and bash syntax on macOS/Linux. Can include pipes, redirects, and chained commands."
			),
		workdir: z
			.string()
			.optional()
			.describe("Working directory to run the command in. Defaults to current working directory."),
		timeout: z
			.number()
			.optional()
			.default(DEFAULT_TIMEOUT_MS)
			.describe("Timeout in milliseconds. Defaults to 20 seconds."),
	}),
	needsApproval: async ({ command }) => {
		if (getBlockedCommandReason(command)) {
			return false;
		}

		const { getDaemonManager } = await import("../../state/daemon-state");
		const manager = getDaemonManager();
		const approvalLevel = manager.bashApprovalLevel;

		if (approvalLevel === "none") {
			return false;
		}

		if (approvalLevel === "all") {
			return true;
		}

		return isDangerousCommand(command) || isSensitivePathAccess(command);
	},
	execute: executeLocalShellCommand,
});
