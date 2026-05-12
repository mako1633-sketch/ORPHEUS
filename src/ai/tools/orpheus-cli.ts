import { tool } from "ai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { executeLocalShellCommand } from "./run-bash";

const commandSchema = z.enum([
	"startup",
	"security",
	"project",
	"task",
	"workflow",
	"scan",
	"suggest",
	"diff",
	"shell",
	"remediate",
	"scheduler",
	"status",
]);

const ARG_PATTERN = /^[\w ./:=@+-]*$/;

function quoteShellArg(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

export function resolveOrpheusCliPath(env: NodeJS.ProcessEnv = process.env): string | null {
	const configured = env.ORPHEUS_CLI_PATH;
	if (configured && fs.existsSync(configured)) {
		return configured;
	}

	const home = env.HOME || os.homedir();
	const directCandidates = [
		path.join(home, ".config", "orpheus", "bin", "orpheus"),
		path.join(home, ".local", "bin", "orpheus"),
	];

	for (const candidate of directCandidates) {
		if (fs.existsSync(candidate)) return candidate;
	}

	try {
		const workspacesDir = path.join(home, ".config", "orpheus", "workspaces");
		const workspaceEntries = fs.readdirSync(workspacesDir, { withFileTypes: true });
		const candidates = workspaceEntries
			.filter((entry) => entry.isDirectory())
			.map((entry) => path.join(workspacesDir, entry.name, "bin", "orpheus"))
			.filter((candidate) => fs.existsSync(candidate))
			.map((candidate) => ({
				candidate,
				mtimeMs: fs.statSync(candidate).mtimeMs,
			}))
			.sort((a, b) => b.mtimeMs - a.mtimeMs);

		return candidates[0]?.candidate ?? null;
	} catch {
		return null;
	}
}

export const orpheusCli = tool({
	description:
		"Execute ORPHEUS local CLI commands to run health checks, security scans, project/registry actions, task orchestration, workflow automation, capability/file scans, proactive suggestions, diff review, shell optimization, and auto-remediation. Available commands: startup, security, project, task, workflow, scan capabilities, scan files, suggest, diff, shell, remediate, scheduler, status. Only runs in explicit user direction or when the user asks about local ORPHEUS tooling.",
	inputSchema: z.object({
		command: commandSchema.describe("The ORPHEUS CLI category/sub-command to run."),
		args: z
			.string()
			.optional()
			.describe("Additional arguments for the command (e.g. 'detect' for project, 'summary' for diff)."),
		auto: z.boolean().optional().describe("For 'suggest': execute the top suggestion automatically."),
	}),
	execute: async ({ command, args, auto }) => {
		const cliPath = resolveOrpheusCliPath();
		if (!cliPath) {
			return {
				success: false,
				error:
					"ORPHEUS CLI bin not found. Set ORPHEUS_CLI_PATH or install it under ~/.config/orpheus/bin, ~/.local/bin, or an ORPHEUS workspace bin directory.",
				stdout: "",
				stderr: "",
				exitCode: null,
				shell: "bash",
			};
		}

		if (args && !ARG_PATTERN.test(args)) {
			return {
				success: false,
				error: "ORPHEUS CLI args contain unsupported shell metacharacters.",
				stdout: "",
				stderr: "",
				exitCode: null,
				shell: "bash",
			};
		}

		let cmd = `${quoteShellArg(cliPath)} ${command}`;
		if (args) cmd += ` ${args}`;
		if (auto && command === "suggest") cmd += " --auto";

		return executeLocalShellCommand({
			command: cmd,
			timeout: 120000,
		});
	},
});
