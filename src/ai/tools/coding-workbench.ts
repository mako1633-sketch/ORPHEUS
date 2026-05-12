import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import {
	clearCodingTaskState,
	loadCodingTaskState,
	saveCodingTaskState,
	updateCodingTaskState,
} from "../coding-task-state";
import { summarizeProjectContext } from "./project-context";

const MAX_OUTPUT = 60_000;
const DEFAULT_TIMEOUT_MS = 120_000;

type ExecResult = {
	success: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	error?: string;
};

function truncate(value: string, max = MAX_OUTPUT): string {
	return value.length > max ? `${value.slice(0, max)}\n... [output truncated]` : value;
}

function resolveRoot(root?: string): string {
	return path.resolve(root ?? process.cwd());
}

function runGit(root: string, args: string[], timeout = 10_000): ExecResult {
	try {
		const stdout = execFileSync("git", args, {
			cwd: root,
			encoding: "utf8",
			timeout,
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { success: true, exitCode: 0, stdout: truncate(stdout.trim()), stderr: "" };
	} catch (error) {
		const err = error as {
			status?: number;
			stdout?: string | Buffer;
			stderr?: string | Buffer;
			message?: string;
		};
		return {
			success: false,
			exitCode: typeof err.status === "number" ? err.status : null,
			stdout: truncate(String(err.stdout ?? "").trim()),
			stderr: truncate(String(err.stderr ?? "").trim()),
			error: err.message,
		};
	}
}

async function readPackage(root: string): Promise<{
	manager?: "bun" | "pnpm" | "yarn" | "npm";
	scripts: Record<string, string>;
}> {
	const project = await summarizeProjectContext({ root, maxFiles: 80 });
	const manager =
		project.success && ["bun", "pnpm", "yarn", "npm"].includes(project.packageManager ?? "")
			? (project.packageManager as "bun" | "pnpm" | "yarn" | "npm")
			: undefined;

	try {
		const raw = await fs.readFile(path.join(root, "package.json"), "utf8");
		const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
		return {
			manager,
			scripts: parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {},
		};
	} catch {
		return { manager, scripts: {} };
	}
}

function chooseValidationScripts(scripts: Record<string, string>): string[] {
	const preferred = ["check", "typecheck", "lint", "test", "format:check"];
	return preferred.filter((name) => scripts[name]);
}

function scriptCommand(manager: string | undefined, script: string): { command: string; args: string[] } {
	switch (manager) {
		case "bun":
			return { command: "bun", args: ["run", script] };
		case "pnpm":
			return { command: "pnpm", args: ["run", script] };
		case "yarn":
			return { command: "yarn", args: [script] };
		default:
			return { command: "npm", args: ["run", script] };
	}
}

async function runCommand(params: {
	root: string;
	command: string;
	args: string[];
	timeout?: number;
	input?: string;
}): Promise<ExecResult> {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let killed = false;
		const child = spawn(params.command, params.args, {
			cwd: params.root,
			env: process.env,
			shell: false,
			windowsHide: true,
		});
		const timeoutId = setTimeout(() => {
			killed = true;
			child.kill(process.platform === "win32" ? undefined : "SIGKILL");
		}, params.timeout ?? DEFAULT_TIMEOUT_MS);

		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => {
			clearTimeout(timeoutId);
			resolve({
				success: false,
				exitCode: null,
				stdout: truncate(stdout.trim()),
				stderr: truncate(stderr.trim()),
				error: error.message,
			});
		});
		child.on("close", (code) => {
			clearTimeout(timeoutId);
			resolve({
				success: code === 0 && !killed,
				exitCode: killed ? null : code,
				stdout: truncate(stdout.trim()),
				stderr: truncate(stderr.trim()),
				error: killed ? `Command timed out after ${params.timeout ?? DEFAULT_TIMEOUT_MS}ms` : undefined,
			});
		});

		if (params.input) child.stdin.end(params.input);
	});
}

function explainFailure(
	command: string,
	output: string
): {
	command: string;
	likelyCause: string;
	nextStep: string;
	signals: string[];
} {
	const text = output.toLowerCase();
	const signals: string[] = [];

	if (text.includes("cannot find module") || text.includes("module not found")) {
		signals.push("module-resolution");
		return {
			command,
			likelyCause: "A dependency, import path, or generated build artifact is missing.",
			nextStep:
				"Inspect the referenced import path, package scripts, and dependency declarations before editing.",
			signals,
		};
	}
	if (text.includes("typescript") || text.includes("tsc") || /\bts\d{4}\b/i.test(output)) {
		signals.push("typescript");
		return {
			command,
			likelyCause: "TypeScript found a type, import, or declaration mismatch.",
			nextStep: "Open the first referenced source file and fix the earliest type error first.",
			signals,
		};
	}
	if (text.includes("snapshot") || text.includes("expect(") || text.includes("assert")) {
		signals.push("test-assertion");
		return {
			command,
			likelyCause: "A test assertion or snapshot no longer matches behavior.",
			nextStep: "Inspect the failing test and implementation together; update behavior before snapshots.",
			signals,
		};
	}
	if (text.includes("format") || text.includes("formatter would have printed")) {
		signals.push("formatting");
		return {
			command,
			likelyCause: "Formatting differs from the repo style.",
			nextStep: "Run the repo formatter or apply the formatter's suggested change.",
			signals,
		};
	}

	return {
		command,
		likelyCause: "The command failed, but no specialized pattern was detected.",
		nextStep:
			"Read the first error block, inspect referenced files, then rerun the narrowest failing command.",
		signals,
	};
}

const inputSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("repoStatus"),
		root: z.string().optional(),
	}),
	z.object({
		action: z.literal("gitDiff"),
		root: z.string().optional(),
		staged: z.boolean().optional().default(false),
		file: z.string().optional(),
		maxChars: z.number().int().min(1000).max(MAX_OUTPUT).optional().default(24_000),
	}),
	z.object({
		action: z.literal("packageScripts"),
		root: z.string().optional(),
	}),
	z.object({
		action: z.literal("runScript"),
		root: z.string().optional(),
		script: z.string().min(1),
		timeout: z.number().int().min(1000).max(600_000).optional().default(DEFAULT_TIMEOUT_MS),
	}),
	z.object({
		action: z.literal("applyPatch"),
		root: z.string().optional(),
		patch: z.string().min(1),
		checkOnly: z.boolean().optional().default(false),
	}),
	z.object({
		action: z.literal("taskState"),
		mode: z.enum(["read", "save", "update", "clear"]),
		goal: z.string().optional(),
		status: z.enum(["planned", "in_progress", "blocked", "completed"]).optional(),
		filesInspected: z.array(z.string()).optional(),
		filesChanged: z.array(z.string()).optional(),
		checksRun: z.array(z.string()).optional(),
		failures: z.array(z.string()).optional(),
		nextStep: z.string().optional(),
	}),
	z.object({
		action: z.literal("explainFailure"),
		command: z.string().min(1),
		output: z.string().min(1),
	}),
]);

export const codingWorkbench = tool({
	description:
		"Use this for coding-agent workflow: inspect git status/diffs, discover package scripts, choose validation commands, run package scripts, apply unified patches, explain command failures, and persist an active coding task ledger between sessions.",
	inputSchema,
	needsApproval: async (input) => {
		return (
			(input.action === "runScript" &&
				!["check", "typecheck", "lint", "format:check", "test"].includes(input.script)) ||
			(input.action === "applyPatch" && !input.checkOnly)
		);
	},
	execute: async (input) => {
		if (input.action === "taskState") {
			if (input.mode === "read") {
				return { success: true, state: await loadCodingTaskState() };
			}
			if (input.mode === "clear") {
				return { success: true, ...(await clearCodingTaskState()) };
			}
			if (input.mode === "save") {
				if (!input.goal) return { success: false, error: "goal is required when saving task state." };
				return { success: true, ...(await saveCodingTaskState(input as { goal: string })) };
			}
			return { success: true, ...(await updateCodingTaskState(input)) };
		}

		if (input.action === "explainFailure") {
			return { success: true, ...explainFailure(input.command, input.output) };
		}

		const root = resolveRoot(input.root);

		if (input.action === "repoStatus") {
			const status = runGit(root, ["status", "--short", "--branch"]);
			const changed = runGit(root, ["diff", "--name-status"]);
			const staged = runGit(root, ["diff", "--cached", "--name-status"]);
			const recent = runGit(root, ["log", "--oneline", "--decorate", "-5"]);
			return {
				success: status.success,
				root,
				status: status.stdout.split(/\r?\n/).filter(Boolean),
				unstagedFiles: changed.stdout.split(/\r?\n/).filter(Boolean),
				stagedFiles: staged.stdout.split(/\r?\n/).filter(Boolean),
				recentCommits: recent.stdout.split(/\r?\n/).filter(Boolean),
				error: status.error || status.stderr || undefined,
			};
		}

		if (input.action === "gitDiff") {
			const args = ["diff"];
			if (input.staged) args.push("--cached");
			if (input.file) args.push("--", input.file);
			const diff = runGit(root, args, 20_000);
			return {
				success: diff.success,
				root,
				staged: input.staged,
				file: input.file,
				diff: truncate(diff.stdout, input.maxChars),
				truncated: diff.stdout.length > input.maxChars,
				stderr: diff.stderr,
				error: diff.error,
			};
		}

		if (input.action === "packageScripts") {
			const pkg = await readPackage(root);
			return {
				success: true,
				root,
				packageManager: pkg.manager,
				scripts: pkg.scripts,
				recommendedValidation: chooseValidationScripts(pkg.scripts),
			};
		}

		if (input.action === "runScript") {
			const pkg = await readPackage(root);
			if (!pkg.scripts[input.script]) {
				return {
					success: false,
					root,
					script: input.script,
					error: `Script '${input.script}' was not found in package.json.`,
					availableScripts: Object.keys(pkg.scripts).sort(),
				};
			}
			const command = scriptCommand(pkg.manager, input.script);
			const result = await runCommand({
				root,
				command: command.command,
				args: command.args,
				timeout: input.timeout,
			});
			const commandText = [command.command, ...command.args].join(" ");
			return {
				...result,
				root,
				script: input.script,
				command: commandText,
				failure: result.success
					? undefined
					: explainFailure(commandText, `${result.stdout}\n${result.stderr}`),
			};
		}

		const args = ["apply"];
		if (input.checkOnly) args.push("--check");
		const result = await runCommand({
			root,
			command: "git",
			args,
			input: input.patch,
			timeout: 30_000,
		});
		return {
			...result,
			root,
			checkOnly: input.checkOnly,
		};
	},
});
