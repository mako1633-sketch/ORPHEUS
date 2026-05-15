import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import {
	clearCodingTaskState,
	type CodingTaskState,
	loadCodingTaskState,
	saveCodingTaskState,
	updateCodingTaskState,
} from "../coding-task-state";
import { addReflection } from "../reflection-state";
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

function classifyChangedFile(file: string): string[] {
	const normalized = file.replace(/\\/g, "/").toLowerCase();
	const risks: string[] = [];

	if (/(^|\/)(package\.json|package-lock\.json|bun\.lock|pnpm-lock\.yaml|yarn\.lock)$/.test(normalized)) {
		risks.push("dependency-or-script-change");
	}
	if (/(^|\/)(\.env|\.env\..*|.*secret.*|.*credential.*)$/.test(normalized)) {
		risks.push("secret-or-environment-change");
	}
	if (normalized.includes("/auth") || normalized.includes("auth-") || normalized.includes("security")) {
		risks.push("auth-or-security-surface");
	}
	if (normalized.includes("/api/") || normalized.includes("provider") || normalized.includes("client")) {
		risks.push("api-or-provider-contract");
	}
	if (normalized.includes("context") || normalized.includes("prompt") || normalized.includes("memory")) {
		risks.push("context-or-memory-behavior");
	}
	if (normalized.includes("tool") || normalized.includes("write-file") || normalized.includes("run-bash")) {
		risks.push("tool-execution-surface");
	}
	if (
		/\.(tsx|jsx|css)$/.test(normalized) ||
		normalized.includes("/components/") ||
		normalized.includes("/ui/")
	) {
		risks.push("ui-state-or-layout");
	}
	if (normalized.includes("test") || normalized.includes("__tests__")) {
		risks.push("test-contract-change");
	}
	if (/\.(ts|tsx|js|jsx)$/.test(normalized)) {
		risks.push("runtime-or-type-regression");
	}

	return risks;
}

function unique(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function buildRiskReview(input: {
	goal?: string;
	changedFiles?: string[];
	diff?: string;
	failures?: string[];
	checksRun?: string[];
	validationScripts?: string[];
}): {
	evidence: string[];
	inferences: string[];
	assumptions: string[];
	risks: string[];
	recommendedChecks: string[];
	completionGate: string[];
} {
	const changedFiles = input.changedFiles ?? [];
	const checksRun = input.checksRun ?? [];
	const failures = input.failures ?? [];
	const diff = input.diff ?? "";
	const validationScripts = input.validationScripts ?? [];
	const riskTags = unique(changedFiles.flatMap(classifyChangedFile));

	if (/writefile|write-file|filesystem|fs\.|writefilesync|appendfilesync|unlink|rename/i.test(diff)) {
		riskTags.push("filesystem-side-effect");
	}
	if (/timeout|abort|retry|stream|async|promise|spawn|exec/i.test(diff)) {
		riskTags.push("async-or-process-lifecycle");
	}
	if (/token|context|prompt|message|history/i.test(diff)) {
		riskTags.push("context-window-or-message-shape");
	}

	const risks = unique([
		...riskTags.map((tag) => {
			switch (tag) {
				case "dependency-or-script-change":
					return "Dependency or package-script changes can break install, build, or validation commands on another machine.";
				case "secret-or-environment-change":
					return "Environment or credential-adjacent files can expose secrets or silently change provider behavior.";
				case "auth-or-security-surface":
					return "Auth or security changes need negative-path checks and must avoid leaking sensitive data.";
				case "api-or-provider-contract":
					return "API/provider contract changes can fail at runtime even when TypeScript passes.";
				case "context-or-memory-behavior":
					return "Context and memory changes can create stale state, prompt bloat, or false continuity.";
				case "tool-execution-surface":
					return "Tool execution changes need verified receipts so ORPHEUS does not claim work that did not land.";
				case "ui-state-or-layout":
					return "UI changes need empty, loading, error, keyboard, and narrow-width states checked.";
				case "test-contract-change":
					return "Test changes can mask regressions if behavior is not checked independently.";
				case "runtime-or-type-regression":
					return "Runtime TypeScript changes need typecheck plus the narrowest behavior test.";
				case "filesystem-side-effect":
					return "Filesystem side effects need readback verification and clear changed-path reporting.";
				case "async-or-process-lifecycle":
					return "Async/process changes can hang, stop early, or leave stale state without timeout and error handling.";
				case "context-window-or-message-shape":
					return "Prompt/message changes can overflow context or alter tool-call formatting.";
				default:
					return tag;
			}
		}),
		failures.length > 0
			? "Existing failed checks must be resolved or explicitly reported before completion."
			: "",
	]);

	const recommendedChecks = unique([
		...validationScripts,
		changedFiles.some((file) => /\.(ts|tsx|js|jsx)$/.test(file)) ? "typecheck" : "",
		changedFiles.some((file) => file.includes("__tests__") || /\.test\./.test(file)) ? "test" : "",
		changedFiles.some((file) => /\.(ts|tsx|js|jsx|json|md|css)$/.test(file)) ? "format:check" : "",
	]);

	const missingChecks = recommendedChecks.filter((check) => !checksRun.some((ran) => ran.includes(check)));
	const completionGate = unique([
		"Confirm the final answer separates observed evidence from inference.",
		"Inspect the final diff and verify only intended files changed.",
		missingChecks.length > 0
			? `Run or explicitly report why these checks were not run: ${missingChecks.join(", ")}.`
			: "Validation coverage appears recorded for the recommended checks.",
		failures.length > 0 ? "Do not mark complete while failures remain unexplained." : "",
		risks.some((risk) => risk.includes("Filesystem side effects"))
			? "For every file write, confirm the saved path and readback/verification signal."
			: "",
		risks.some((risk) => risk.includes("UI changes"))
			? "For UI changes, verify representative narrow and desktop layouts when practical."
			: "",
	]);

	return {
		evidence: unique([
			input.goal ? `Goal: ${input.goal}` : "",
			changedFiles.length > 0 ? `Changed files: ${changedFiles.join(", ")}` : "",
			checksRun.length > 0 ? `Checks run: ${checksRun.join(", ")}` : "",
			failures.length > 0 ? `Failures observed: ${failures.join("; ")}` : "",
		]),
		inferences: unique([
			riskTags.length > 0 ? `Risk tags inferred from filenames/diff: ${unique(riskTags).join(", ")}` : "",
			diff
				? "Diff text was provided for review."
				: "No diff text was provided; risk review is based on filenames and recorded checks.",
		]),
		assumptions: unique([
			changedFiles.length === 0
				? "No changed files were provided, so the review cannot verify edit scope."
				: "",
			checksRun.length === 0 ? "No checks were recorded yet." : "",
		]),
		risks,
		recommendedChecks,
		completionGate,
	};
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

function codingModeProfile(profile: string): {
	profile: string;
	defaultLoop: string[];
	validationBias: string[];
	outputStyle: string;
} {
	switch (profile) {
		case "fastFix":
			return {
				profile,
				defaultLoop: [
					"Inspect the failing surface",
					"Patch the smallest likely cause",
					"Run one targeted check",
				],
				validationBias: ["targeted test", "typecheck when TypeScript changed"],
				outputStyle: "Brief: changed file, check result, residual risk only.",
			};
		case "carefulRefactor":
			return {
				profile,
				defaultLoop: [
					"Map call sites",
					"Preserve behavior",
					"Patch in narrow stages",
					"Run broad validation",
				],
				validationBias: ["typecheck", "test", "lint", "diff review"],
				outputStyle: "Concise but include migration/compatibility notes.",
			};
		case "testFirst":
			return {
				profile,
				defaultLoop: ["Add or identify failing test", "Make it pass", "Check adjacent cases"],
				validationBias: ["focused test", "full test suite when practical"],
				outputStyle: "Lead with test added/updated and pass/fail result.",
			};
		case "securityReview":
			return {
				profile,
				defaultLoop: [
					"Identify trust boundaries",
					"Check secrets/auth/input paths",
					"Prefer read-only evidence",
				],
				validationBias: ["negative-path tests", "dependency/config review", "secret exposure check"],
				outputStyle: "Findings first, severity and evidence, no exploit details.",
			};
		case "releasePrep":
			return {
				profile,
				defaultLoop: ["Check git status", "Run full validation", "Inspect docs/version/build artifacts"],
				validationBias: ["check", "build", "test", "README/release notes"],
				outputStyle: "Ship-readiness summary with blockers and commands run.",
			};
		default:
			return {
				profile: "explainOnly",
				defaultLoop: [
					"Inspect enough context to be accurate",
					"Explain behavior and tradeoffs",
					"Avoid edits",
				],
				validationBias: ["no mutation", "cite local files when used"],
				outputStyle: "Answer directly with file references when useful.",
			};
	}
}

async function projectDoctor(root: string): Promise<{
	success: boolean;
	root: string;
	summary: string[];
	checks: Array<{ id: string; status: "ok" | "watch" | "repair"; detail: string; fix?: string }>;
	recommendedNextActions: string[];
}> {
	const project = await summarizeProjectContext({ root, maxFiles: 200 });
	if (!project.success) {
		return {
			success: false,
			root,
			summary: [],
			checks: [{ id: "project", status: "repair", detail: project.error ?? "Project inspection failed." }],
			recommendedNextActions: ["Fix the project path or permissions, then rerun project doctor."],
		};
	}
	const importantFiles = project.importantFiles ?? [];
	const pkg = await readPackage(root);
	const git = runGit(root, ["status", "--short", "--branch"]);
	const validation = chooseValidationScripts(pkg.scripts);
	const checks = [
		{
			id: "package",
			status: project.package ? ("ok" as const) : ("watch" as const),
			detail: project.package
				? `${project.package.name ?? "package.json"} with ${Object.keys(pkg.scripts).length} scripts.`
				: "No package.json detected.",
			fix: project.package
				? undefined
				: "If this is a JS/TS project, add package.json scripts for check/test.",
		},
		{
			id: "packageManager",
			status: project.packageManager ? ("ok" as const) : ("watch" as const),
			detail: project.packageManager
				? `${project.packageManager} lockfile detected.`
				: "No lockfile detected.",
			fix: project.packageManager ? undefined : "Commit a lockfile for reproducible installs.",
		},
		{
			id: "validation",
			status: validation.length > 0 ? ("ok" as const) : ("repair" as const),
			detail:
				validation.length > 0
					? `Validation scripts: ${validation.join(", ")}.`
					: "No standard check/typecheck/lint/test script found.",
			fix: validation.length > 0 ? undefined : "Add at least one repeatable validation script.",
		},
		{
			id: "git",
			status: git.success ? ("ok" as const) : ("watch" as const),
			detail: git.success ? (git.stdout.split(/\r?\n/)[0] ?? "Git repository detected.") : "Not a git repo.",
			fix: git.success ? undefined : "Initialize git before publishing or release prep.",
		},
		{
			id: "docs",
			status: importantFiles.includes("README.md") ? ("ok" as const) : ("watch" as const),
			detail: importantFiles.includes("README.md") ? "README.md present." : "README.md missing.",
			fix: importantFiles.includes("README.md") ? undefined : "Add a README before publishing.",
		},
	];
	return {
		success: true,
		root: project.root,
		summary: [
			`Package manager: ${project.packageManager ?? "unknown"}`,
			`Important files: ${importantFiles.join(", ") || "none detected"}`,
			`Files sampled: ${project.fileCountReturned}${project.truncated ? " (truncated)" : ""}`,
		],
		checks,
		recommendedNextActions: checks
			.filter((check) => check.status !== "ok")
			.map((check) => check.fix ?? check.detail)
			.slice(0, 6),
	};
}

function githubPublishPlan(
	root: string,
	repoName?: string
): {
	root: string;
	repoName?: string;
	steps: string[];
	secretChecks: string[];
	verification: string[];
	requiresApproval: string[];
} {
	const status = runGit(root, ["status", "--short", "--branch"]);
	const remote = runGit(root, ["remote", "-v"]);
	return {
		root,
		repoName,
		steps: [
			status.success
				? "Review current git status and decide what belongs in the initial commit."
				: "Initialize git.",
			"Run secret scan patterns against .env, keys, tokens, credentials, and generated artifacts before staging.",
			"Ensure README, license, install, run, and validation instructions are current.",
			"Create or select the GitHub repository.",
			"Commit with a concise message, push the branch, then verify the remote URL and GitHub page.",
		],
		secretChecks: [
			"Never stage .env, API keys, tokens, SSH keys, credentials, local caches, or private logs.",
			"Check git diff --cached before commit.",
			"Confirm .gitignore covers local config and build artifacts.",
		],
		verification: [
			remote.success && remote.stdout ? `Existing remotes: ${remote.stdout}` : "No existing remote detected.",
			status.success ? `Current status: ${status.stdout || "clean"}` : "Git status unavailable.",
			"After push, run git remote -v and git status --short --branch.",
		],
		requiresApproval: ["Creating a GitHub repo", "Committing files", "Pushing to GitHub", "Changing remotes"],
	};
}

function failureRecovery(input: { command?: string; output: string }): {
	failure: ReturnType<typeof explainFailure>;
	strategy: "retry" | "pivot" | "ask_user" | "stop_and_report";
	reason: string;
	recovery: string[];
	pivotPlan: string[];
	alternateRoutes: string[];
	retryPolicy: string[];
} {
	const command = input.command ?? "last command";
	const output = input.output;
	const failure = explainFailure(command, output);
	const isTransient =
		/\b(econnreset|etimedout|eai_again|enotfound|network|socket hang up|rate limit|429|503|temporar)/i.test(
			output
		);
	const needsUser =
		/\b(permission denied|not authorized|unauthorized|forbidden|401|403|login|sign in|authenticate|approval required|operation not permitted)\b/i.test(
			output
		);
	const timedOut = /\b(timed out|timeout|aborted|signal sigterm|signal sigkill)\b/i.test(output);
	const contextTooLarge =
		/\b(context length|prompt too long|maximum context|token limit|too many tokens)\b/i.test(output);
	const deterministic =
		failure.signals.some((signal) =>
			["module-resolution", "typescript", "test-assertion", "formatting"].includes(signal)
		) || /\b(schema|parse error|syntaxerror|typeerror|referenceerror|lint)\b/i.test(output);

	const strategy: "retry" | "pivot" | "ask_user" | "stop_and_report" = needsUser
		? "ask_user"
		: isTransient
			? "retry"
			: deterministic || timedOut || contextTooLarge
				? "pivot"
				: "pivot";

	const reason =
		strategy === "ask_user"
			? "The failure appears to require user approval, credentials, or permissions."
			: strategy === "retry"
				? "The failure looks transient, so one bounded retry is reasonable."
				: contextTooLarge
					? "The failure is likely caused by context size, so shrink the input and resume from saved state."
					: timedOut
						? "The command ran too long, so narrow the scope before trying again."
						: deterministic
							? "The failure is deterministic, so inspect evidence and change the approach before retrying."
							: "The failure lacks a safe immediate retry signal, so pivot to diagnosis first.";

	return {
		failure,
		strategy,
		reason,
		recovery: [
			"Read the first concrete error, not the last cascade.",
			"Inspect the referenced file or config before editing.",
			"Patch the smallest cause and rerun the narrowest failing command.",
			"Persist the failure and next step if the task is interrupted.",
		],
		pivotPlan: unique([
			"Record the failed command/output in taskState before changing direction.",
			contextTooLarge
				? "Compact the working context to goal, touched files, evidence, failures, and next step."
				: "",
			timedOut ? "Replace the broad command with the smallest targeted script or file-level check." : "",
			failure.signals.includes("module-resolution")
				? "Inspect the import path, package manager lockfile, generated files, and tsconfig/module aliases."
				: "",
			failure.signals.includes("typescript")
				? "Open the first TypeScript diagnostic location and fix errors in dependency order."
				: "",
			failure.signals.includes("test-assertion")
				? "Read the failing test and implementation together, then decide whether behavior or expectation is wrong."
				: "",
			failure.signals.includes("formatting")
				? "Run the formatter or apply the formatter output before rerunning broader validation."
				: "",
			needsUser ? "Pause mutation and ask for the specific approval or authentication step required." : "",
			isTransient
				? "Retry once after a short wait, then pivot to diagnostics if the same failure repeats."
				: "",
			"After the pivot, rerun only the narrowest command that proves the new hypothesis.",
		]),
		alternateRoutes: unique([
			contextTooLarge ? "Use git diff plus targeted file reads instead of sending whole files." : "",
			timedOut
				? "Run a focused test file, typecheck subset, or package script with a longer timeout only if needed."
				: "",
			failure.signals.includes("module-resolution")
				? "Search for the exported symbol or neighboring file before creating a new dependency."
				: "",
			failure.signals.includes("typescript")
				? "If the first fix fans out, add a local type guard or adapter instead of widening shared types globally."
				: "",
			failure.signals.includes("test-assertion")
				? "Add a smaller regression test around the expected behavior before broad snapshot updates."
				: "",
			needsUser
				? "Use available local evidence and report the blocked external step without pretending it ran."
				: "",
			isTransient ? "Switch provider/route or resume from taskState if the retry fails again." : "",
		]),
		retryPolicy: [
			"Retry immediately only for transient provider/network errors, and only once before pivoting.",
			"Do not retry deterministic type, lint, test, or schema failures without changing something.",
			"If a broad command times out, pivot to a narrower command before increasing timeout.",
			"Escalate to the user only when approval, credentials, or external service access is required.",
		],
	};
}

function completionGate(input: {
	goal?: string;
	changedFiles?: string[];
	checksRun?: string[];
	failures?: string[];
}): {
	ready: boolean;
	blockers: string[];
	requiredEvidence: string[];
	recommendedNextActions: string[];
} {
	const changedFiles = input.changedFiles ?? [];
	const checksRun = input.checksRun ?? [];
	const failures = input.failures ?? [];
	const hasRuntimeChange = changedFiles.some((file) => /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go)$/.test(file));
	const hasTestChange = changedFiles.some((file) => file.includes("__tests__") || /\.test\./.test(file));
	const hasPromptOrMemoryChange = changedFiles.some((file) =>
		/prompt|memory|context|provider|tool/i.test(file)
	);
	const hasTypecheck = checksRun.some((check) => /typecheck|tsc|check/i.test(check));
	const hasTest = checksRun.some((check) =>
		/\btest\b|bun test|npm test|pnpm test|pytest|cargo test/i.test(check)
	);
	const hasLintOrFormat = checksRun.some((check) => /lint|format|biome/i.test(check));

	const blockers = unique([
		failures.length > 0 ? `Unresolved failures: ${failures.join("; ")}` : "",
		changedFiles.length === 0 ? "No changed files were recorded." : "",
		hasRuntimeChange && !hasTypecheck
			? "Runtime code changed but no typecheck/check command was recorded."
			: "",
		hasTestChange && !hasTest ? "Tests changed but no test command was recorded." : "",
		hasPromptOrMemoryChange && !hasTest
			? "Prompt, memory, provider, or tool behavior changed without a focused regression test."
			: "",
	]);

	const requiredEvidence = unique([
		input.goal ? `Goal matched: ${input.goal}` : "User goal restated and matched to the final diff.",
		"Final diff inspected for unrelated churn.",
		"Changed files listed in the final response.",
		"Validation commands and outcomes listed in the final response.",
		hasRuntimeChange ? "Type/runtime validation has passed or the gap is explicitly disclosed." : "",
		hasPromptOrMemoryChange ? "A regression test covers the changed agent behavior." : "",
	]);

	const recommendedNextActions = unique([
		blockers.includes("No changed files were recorded.") ? "Record changed files before completion." : "",
		hasRuntimeChange && !hasTypecheck ? "Run the repo typecheck/check script." : "",
		hasTestChange && !hasTest ? "Run the relevant test command." : "",
		!hasLintOrFormat ? "Run lint or format check if the repo provides one." : "",
		failures.length > 0 ? "Fix or explicitly report each unresolved failure." : "",
	]);

	return {
		ready: blockers.length === 0,
		blockers,
		requiredEvidence,
		recommendedNextActions,
	};
}

async function recordCompletedCodingLearning(state: CodingTaskState): Promise<void> {
	await addReflection({
		taskType: "coding",
		goal: state.goal,
		whatWorked: [...state.evidence, ...state.checksRun],
		whatFailed: state.failures,
		validationThatCaught: state.failures.length > 0 ? state.checksRun : [],
		keyAssumptions: state.assumptions,
		risksSurfaced: state.risks,
	});
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
		evidence: z.array(z.string()).optional(),
		assumptions: z.array(z.string()).optional(),
		risks: z.array(z.string()).optional(),
		nextStep: z.string().optional(),
	}),
	z.object({
		action: z.literal("selfReview"),
		goal: z.string().optional(),
		changedFiles: z.array(z.string()).optional(),
		diff: z.string().optional(),
		failures: z.array(z.string()).optional(),
		checksRun: z.array(z.string()).optional(),
		validationScripts: z.array(z.string()).optional(),
	}),
	z.object({
		action: z.literal("projectDoctor"),
		root: z.string().optional(),
	}),
	z.object({
		action: z.literal("modeProfile"),
		profile: z.enum([
			"fastFix",
			"carefulRefactor",
			"testFirst",
			"securityReview",
			"releasePrep",
			"explainOnly",
		]),
	}),
	z.object({
		action: z.literal("githubPublishPlan"),
		root: z.string().optional(),
		repoName: z.string().optional(),
	}),
	z.object({
		action: z.literal("failureRecovery"),
		command: z.string().optional(),
		output: z.string().min(1),
	}),
	z.object({
		action: z.literal("completionGate"),
		goal: z.string().optional(),
		changedFiles: z.array(z.string()).optional(),
		checksRun: z.array(z.string()).optional(),
		failures: z.array(z.string()).optional(),
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
				const result = await saveCodingTaskState(input as { goal: string });
				// Self-reflection: write a retrospective when a coding task completes
				if (result.state.status === "completed") {
					await recordCompletedCodingLearning(result.state);
				}
				return { success: true, ...result };
			}
			const result = await updateCodingTaskState(input);
			// Self-reflection: write a retrospective when a coding task completes
			if (result.state.status === "completed") {
				await recordCompletedCodingLearning(result.state);
			}
			return { success: true, ...result };
		}

		if (input.action === "explainFailure") {
			return { success: true, ...explainFailure(input.command, input.output) };
		}

		if (input.action === "selfReview") {
			return { success: true, ...buildRiskReview(input) };
		}

		if (input.action === "modeProfile") {
			return { success: true, ...codingModeProfile(input.profile) };
		}

		if (input.action === "failureRecovery") {
			return { success: true, ...failureRecovery(input) };
		}

		if (input.action === "completionGate") {
			return { success: true, ...completionGate(input) };
		}

		const root = resolveRoot(input.root);

		if (input.action === "projectDoctor") {
			return projectDoctor(root);
		}

		if (input.action === "githubPublishPlan") {
			return { success: true, ...githubPublishPlan(root, input.repoName) };
		}

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
