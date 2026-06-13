import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FindEvilArtifact, FindEvilToolName, FindEvilToolResult } from "./types";
import {
	createTriageTracer,
	selfCheckToolResult,
	selfCheckRun,
	validateCompletionGate,
	persistCaseRun,
	autoCompareCase,
	writeReasoningArtifact,
	writeSelfCheckArtifact,
	writeCompletionGateArtifact,
	writeTrendArtifact,
	pushDfirTask,
	type ToolReasoningTrace,
} from "./reasoning-enhancements";

const DEFAULT_OUTPUT_DIR = "find-evil-runs";
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_CAPTURE_BYTES = 1_000_000;
const TOOL_NAMES: FindEvilToolName[] = [
	"hash_evidence",
	"inspect_partitions",
	"list_files",
	"extract_file_metadata",
	"build_timeline",
	"search_indicators",
	"summarize_findings",
];

export interface FindEvilConfigInput {
	imagePath?: string;
	caseId?: string;
	outputDir?: string;
	allowWritableImage?: boolean;
	enableReasoning?: boolean;
}

export interface FindEvilContext {
	imagePath: string;
	caseId: string;
	outputDir: string;
	runDir: string;
	allowWritableImage: boolean;
	commandRunner: CommandRunner;
	now: () => Date;
	enableReasoning: boolean;
	/** Mutable accumulation of results for a single reasoning-gated run. Populated by callFindEvilTool when reasoning is on. */
	reasoningResults?: FindEvilToolResult[];
	/** Triage tracer for step-by-step audit trail. Present when reasoning is enabled. */
	tracer?: ReturnType<typeof createTriageTracer>;
}

export interface CommandResult {
	success: boolean;
	exitCode: number | null;
	command: string;
	args: string[];
	stdout: string;
	stderr: string;
	error?: string;
}

export type CommandRunner = (
	command: string,
	args: string[],
	options?: { timeoutMs?: number; cwd?: string }
) => Promise<CommandResult>;

export type ToolHandler<TInput extends Record<string, unknown> = Record<string, unknown>> = (
	ctx: FindEvilContext,
	input: TInput
) => Promise<FindEvilToolResult>;

export function getFindEvilToolNames(): FindEvilToolName[] {
	return [...TOOL_NAMES];
}

export function slugifyCaseId(raw: string): string {
	const cleaned = raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return cleaned || "find-evil-case";
}

export function resolveFindEvilConfig(
	input: FindEvilConfigInput = {},
	env: NodeJS.ProcessEnv = process.env
): FindEvilConfigInput {
	return {
		imagePath: input.imagePath ?? env.ORPHEUS_FIND_EVIL_IMAGE,
		caseId: input.caseId ?? env.ORPHEUS_FIND_EVIL_CASE_ID,
		outputDir: input.outputDir ?? env.ORPHEUS_FIND_EVIL_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR,
		allowWritableImage:
			input.allowWritableImage ?? env.ORPHEUS_FIND_EVIL_ALLOW_WRITABLE_IMAGE === "true",
		enableReasoning: input.enableReasoning ?? env.ORPHEUS_FIND_EVIL_ENABLE_REASONING === "true",
	};
}

export async function createFindEvilContext(
	input: FindEvilConfigInput = {},
	options: { commandRunner?: CommandRunner; now?: () => Date } = {}
): Promise<FindEvilContext> {
	const resolved = resolveFindEvilConfig(input);
	const imagePath = resolved.imagePath?.trim();
	if (!imagePath) {
		throw new Error("ORPHEUS_FIND_EVIL_IMAGE or --image is required.");
	}
	if (!path.isAbsolute(imagePath)) {
		throw new Error("Evidence image path must be absolute.");
	}

	const imageStats = await stat(imagePath).catch(() => null);
	if (!imageStats?.isFile()) {
		throw new Error(`Evidence image does not exist or is not a file: ${imagePath}`);
	}

	await access(imagePath);
	const allowWritableImage = resolved.allowWritableImage === true;
	if (!allowWritableImage && (imageStats.mode & 0o222) !== 0) {
		throw new Error(
			"Evidence image is writable. Make it read-only or set ORPHEUS_FIND_EVIL_ALLOW_WRITABLE_IMAGE=true for a documented exception."
		);
	}

	const caseId = slugifyCaseId(
		resolved.caseId ?? path.basename(imagePath, path.extname(imagePath))
	);
	const outputDir = path.resolve(resolved.outputDir ?? DEFAULT_OUTPUT_DIR);
	const runDir = path.join(outputDir, caseId);
	await mkdir(runDir, { recursive: true });

	const enableReasoning = resolved.enableReasoning === true;
	const ctx: FindEvilContext = {
		imagePath,
		caseId,
		outputDir,
		runDir,
		allowWritableImage,
		commandRunner: options.commandRunner ?? runCommand,
		now: options.now ?? (() => new Date()),
		enableReasoning,
	};

	if (enableReasoning) {
		ctx.tracer = createTriageTracer(caseId);
		ctx.reasoningResults = [];
		await pushDfirTask(caseId, "case_opened", "open", `Image: ${imagePath}`);
	}

	return ctx;
}

export async function runCommand(
	command: string,
	args: string[],
	options: { timeoutMs?: number; cwd?: string } = {}
): Promise<CommandResult> {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let killed = false;
		const child = spawn(command, args, {
			cwd: options.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, CI: process.env.CI ?? "1" },
		});
		const timeout = setTimeout(() => {
			killed = true;
			child.kill("SIGKILL");
		}, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

		child.stdout.on("data", (chunk: Buffer) => {
			if (stdout.length < MAX_CAPTURE_BYTES) stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			if (stderr.length < MAX_CAPTURE_BYTES) stderr += chunk.toString();
		});
		child.on("error", (error) => {
			clearTimeout(timeout);
			resolve({
				success: false,
				exitCode: null,
				command,
				args,
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				error: error instanceof Error ? error.message : String(error),
			});
		});
		child.on("close", (code) => {
			clearTimeout(timeout);
			resolve({
				success: !killed && code === 0,
				exitCode: code,
				command,
				args,
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				error: killed
					? `Command timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`
					: undefined,
			});
		});
	});
}

export async function sha256File(filePath: string): Promise<{ sha256: string; bytes: number }> {
	const hash = createHash("sha256");
	let bytes = 0;
	await new Promise<void>((resolve, reject) => {
		const stream = createReadStream(filePath);
		stream.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			hash.update(chunk);
		});
		stream.on("error", reject);
		stream.on("end", resolve);
	});
	return { sha256: hash.digest("hex"), bytes };
}

export async function writeArtifact(
	ctx: FindEvilContext,
	name: string,
	content: string
): Promise<FindEvilArtifact> {
	const target = path.join(ctx.runDir, name);
	await writeFile(target, content);
	const { sha256, bytes } = await sha256File(target);
	return { path: target, sha256, bytes };
}

async function appendExecutionLog(ctx: FindEvilContext, result: FindEvilToolResult): Promise<void> {
	const logPath = path.join(ctx.runDir, "execution-log.ndjson");
	await appendFile(logPath, `${JSON.stringify(result)}\n`);
}

async function finalizeToolResult(
	ctx: FindEvilContext,
	tool: FindEvilToolName,
	startedAt: string,
	inputs: Record<string, unknown>,
	partial: Omit<FindEvilToolResult, "caseId" | "tool" | "startedAt" | "finishedAt" | "inputs">
): Promise<FindEvilToolResult> {
	const result: FindEvilToolResult = {
		caseId: ctx.caseId,
		tool,
		startedAt,
		finishedAt: ctx.now().toISOString(),
		inputs,
		...partial,
	};

	// 1. Self-check enhancement
	if (ctx.enableReasoning) {
		result.selfCheck = selfCheckToolResult(result);
	}

	await appendExecutionLog(ctx, result);

	// Accumulate for gate check
	if (ctx.reasoningResults) {
		ctx.reasoningResults.push(result);
	}

	return result;
}

async function commandArtifact(
	ctx: FindEvilContext,
	name: string,
	command: string,
	args: string[],
	result: CommandResult
): Promise<FindEvilArtifact> {
	const content = [
		`$ ${command} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`,
		`exitCode: ${result.exitCode}`,
		result.error ? `error: ${result.error}` : "",
		"",
		"## stdout",
		result.stdout,
		"",
		"## stderr",
		result.stderr,
	].join("\n");
	return writeArtifact(ctx, name, content);
}

/** Parse partitions.txt to auto-extract the first data partition offset (sectors). */
async function readAutoPartitionOffset(ctx: FindEvilContext): Promise<number | undefined> {
	const partitionsPath = path.join(ctx.runDir, "partitions.txt");
	const content = await readFile(partitionsPath, "utf8").catch(() => null);
	if (!content) return undefined;

	// Volume images have a marker injected by inspect_partitions when fsstat succeeds.
	const volumeMatch = content.match(/# ORPHEUS_VOLUME_IMAGE:\s*offset=(\d+)/);
	if (volumeMatch && volumeMatch[1]) {
		const offset = parseInt(volumeMatch[1], 10);
		if (!Number.isNaN(offset)) return offset;
	}

	// mmls data-partition lines look like:
	// 01:  00:00   0000002048   0000974847   0000972800   Linux (0x83)
	// We skip metadata lines (slot has "-----") and capture the Start column.
	for (const line of content.split(/\r?\n/)) {
		const match = line.match(/^\s*\d+:\s+\d+:\d+\s+(\d+)\s+/);
		if (match && match[1]) {
			const offset = parseInt(match[1], 10);
			if (!Number.isNaN(offset) && offset > 0) return offset;
		}
	}
	return undefined;
}

export const findEvilToolHandlers: Record<FindEvilToolName, ToolHandler> = {
	hash_evidence: async (ctx, input) => {
		const startedAt = ctx.now().toISOString();
		ctx.tracer?.logStep(
			"hash_evidence",
			"Compute SHA-256 of evidence image",
			`Image: ${ctx.imagePath}`,
			"Integrity baseline before any tool execution"
		);

		const artifact = await writeArtifact(
			ctx,
			"evidence-hash.json",
			JSON.stringify({ imagePath: ctx.imagePath, ...(await sha256File(ctx.imagePath)) }, null, 2)
		);

		ctx.tracer?.logStep(
			"hash_evidence",
			"Artifact written",
			`Path: ${artifact.path}, SHA-256: ${artifact.sha256?.slice(0, 16)}...`,
			"Hash artifact is immutable and verifiable"
		);

		return finalizeToolResult(ctx, "hash_evidence", startedAt, input, {
			success: true,
			artifacts: [artifact],
			summary: "Computed SHA-256 hash for the external evidence image without modifying it.",
			warnings: ctx.allowWritableImage
				? ["Writable-image exception was enabled for this run."]
				: [],
		});
	},

	inspect_partitions: async (ctx, input) => {
		const startedAt = ctx.now().toISOString();
		ctx.tracer?.logStep(
			"inspect_partitions",
			"Run mmls",
			`Image: ${ctx.imagePath}`,
			"Partition layout required for subsequent offset-dependent tools"
		);

		const mmlsResult = await ctx.commandRunner("mmls", [ctx.imagePath]);

		ctx.tracer?.logStep(
			"inspect_partitions",
			"Capture mmls output",
			`exitCode=${mmlsResult.exitCode}, stdout.length=${mmlsResult.stdout.length}`,
			mmlsResult.success
				? "Partition table readable"
				: "mmls failed — checking for volume image with fsstat fallback"
		);

		// If mmls succeeds, use it directly.
		if (mmlsResult.success) {
			const artifact = await commandArtifact(
				ctx,
				"partitions.txt",
				"mmls",
				[ctx.imagePath],
				mmlsResult
			);
			return finalizeToolResult(ctx, "inspect_partitions", startedAt, input, {
				success: true,
				artifacts: [artifact],
				summary: "Inspected disk image partition layout with mmls.",
				warnings: mmlsResult.stderr ? [mmlsResult.stderr] : [],
			});
		}

		// Fallback: run fsstat to detect a volume image (single filesystem, no partition table).
		const fsstatResult = await ctx.commandRunner("fsstat", [ctx.imagePath]);

		ctx.tracer?.logStep(
			"inspect_partitions",
			"Capture fsstat output",
			`exitCode=${fsstatResult.exitCode}, stdout.length=${fsstatResult.stdout.length}`,
			fsstatResult.success
				? "fsstat succeeded — image is a single volume, use offset 0"
				: "fsstat also failed — image may be corrupted or unsupported"
		);

		const artifactContent = [
			"# mmls result (partition table not found)",
			`$ mmls ${JSON.stringify(ctx.imagePath)}`,
			`exitCode: ${mmlsResult.exitCode}`,
			mmlsResult.error ? `error: ${mmlsResult.error}` : "",
			"",
			"## stdout",
			mmlsResult.stdout,
			"",
			"## stderr",
			mmlsResult.stderr,
			"",
			"# fsstat result (volume image fallback)",
			`$ fsstat ${JSON.stringify(ctx.imagePath)}`,
			`exitCode: ${fsstatResult.exitCode}`,
			fsstatResult.error ? `error: ${fsstatResult.error}` : "",
			"",
			"## stdout",
			fsstatResult.stdout,
			"",
			"## stderr",
			fsstatResult.stderr,
			"",
			fsstatResult.success
				? "# ORPHEUS_VOLUME_IMAGE: offset=0"
				: "# ORPHEUS: Both mmls and fsstat failed — image may be corrupted or unsupported.",
		].join("\n");
		const artifact = await writeArtifact(ctx, "partitions.txt", artifactContent);

		const success = fsstatResult.success;
		const summary = success
			? "No partition table found (mmls failed). fsstat detected a single volume image — use offset 0 for subsequent tools."
			: "Partition inspection failed; both mmls and fsstat failed. Verify the image format and sleuthkit tools installation.";

		return finalizeToolResult(ctx, "inspect_partitions", startedAt, input, {
			success,
			artifacts: [artifact],
			summary,
			warnings: [
				...(mmlsResult.stderr ? [`mmls: ${mmlsResult.stderr}`] : []),
				...(fsstatResult.stderr ? [`fsstat: ${fsstatResult.stderr}`] : []),
			],
			error: fsstatResult.error ?? mmlsResult.error,
		});
	},

	list_files: async (ctx, input) => {
		const startedAt = ctx.now().toISOString();
		let offset = typeof input.offset === "number" ? String(input.offset) : undefined;
		let autoOffsetWarning: string | undefined;

		if (!offset) {
			ctx.tracer?.logStep(
				"list_files",
				"Attempt auto-extract partition offset",
				"No explicit offset provided",
				"Checking prior inspect_partitions artifact"
			);
			const autoOffset = await readAutoPartitionOffset(ctx);
			if (autoOffset !== undefined) {
				offset = String(autoOffset);
				autoOffsetWarning = `Auto-extracted partition offset ${autoOffset} from prior inspect_partitions result.`;
				ctx.tracer?.logStep(
					"list_files",
					"Auto-extracted offset",
					`offset=${autoOffset}`,
					autoOffset === 0
						? "Volume image detected — no partition table needed"
						: "Using first data partition found in partitions.txt"
				);
				await pushDfirTask(ctx.caseId, "partition_auto_extracted", "done", `offset=${autoOffset}`);
			} else {
				ctx.tracer?.logStep(
					"list_files",
					"No auto-offset available",
					"partitions.txt missing or no data partition",
					"Will run fls without -o flag"
				);
			}
		} else {
			ctx.tracer?.logStep(
				"list_files",
				"Use explicit offset",
				`offset=${offset}`,
				"Explicit offset overrides auto-extraction"
			);
		}

		const command = "fls";
		const args = ["-r", "-p", ...(offset ? ["-o", offset] : []), ctx.imagePath];
		const commandResult = await ctx.commandRunner(command, args);

		ctx.tracer?.logStep(
			"list_files",
			"Run fls",
			`exitCode=${commandResult.exitCode}, stdout.lines=${commandResult.stdout.split(/\r?\n/).length}`,
			commandResult.success
				? "File enumeration succeeded"
				: "fls failed — likely wrong partition offset"
		);

		if (!commandResult.success && !offset) {
			await pushDfirTask(
				ctx.caseId,
				"self_correction_triggered",
				"open",
				"list_files failed without offset — rerun with --offset recommended"
			);
		}

		const artifact = await commandArtifact(ctx, "file-list.txt", command, args, commandResult);

		const warnings = commandResult.stderr ? [commandResult.stderr] : [];
		if (autoOffsetWarning) warnings.unshift(autoOffsetWarning);

		return finalizeToolResult(ctx, "list_files", startedAt, input, {
			success: commandResult.success,
			artifacts: [artifact],
			summary: commandResult.success
				? autoOffsetWarning
					? `Enumerated files recursively with fls using auto-extracted partition offset ${offset}.`
					: "Enumerated files recursively with fls."
				: "File listing failed; provide a valid partition offset if the image has partitions.",
			warnings,
			error: commandResult.error,
		});
	},

	extract_file_metadata: async (ctx, input) => {
		const startedAt = ctx.now().toISOString();
		const inode = String(input.inode ?? "").trim();
		if (!inode) {
			return finalizeToolResult(ctx, "extract_file_metadata", startedAt, input, {
				success: false,
				artifacts: [],
				summary: "Missing inode parameter.",
				warnings: [],
				error: "inode is required.",
			});
		}
		const offset = typeof input.offset === "number" ? String(input.offset) : undefined;
		const command = "istat";
		const args = [...(offset ? ["-o", offset] : []), ctx.imagePath, inode];
		const commandResult = await ctx.commandRunner(command, args);
		const artifact = await commandArtifact(
			ctx,
			`metadata-${inode}.txt`,
			command,
			args,
			commandResult
		);
		return finalizeToolResult(ctx, "extract_file_metadata", startedAt, input, {
			success: commandResult.success,
			artifacts: [artifact],
			summary: commandResult.success
				? `Extracted inode metadata for ${inode}.`
				: "Metadata extraction failed; verify the inode and partition offset.",
			warnings: commandResult.stderr ? [commandResult.stderr] : [],
			error: commandResult.error,
		});
	},

	build_timeline: async (ctx, input) => {
		const startedAt = ctx.now().toISOString();
		let offset = typeof input.offset === "number" ? String(input.offset) : undefined;
		let autoOffsetWarning: string | undefined;

		if (!offset) {
			const autoOffset = await readAutoPartitionOffset(ctx);
			if (autoOffset !== undefined) {
				offset = String(autoOffset);
				autoOffsetWarning = `Auto-extracted partition offset ${autoOffset} from prior inspect_partitions result.`;
				ctx.tracer?.logStep(
					"build_timeline",
					"Auto-extracted offset",
					`offset=${autoOffset}`,
					autoOffset === 0
						? "Volume image detected — no partition table needed"
						: "Reusing partition offset from prior inspect_partitions"
				);
			}
		}

		const flsArgs = ["-r", "-m", "/", ...(offset ? ["-o", offset] : []), ctx.imagePath];
		const flsResult = await ctx.commandRunner("fls", flsArgs);
		const bodyArtifact = await commandArtifact(ctx, "timeline.body", "fls", flsArgs, flsResult);
		if (!flsResult.success) {
			return finalizeToolResult(ctx, "build_timeline", startedAt, input, {
				success: false,
				artifacts: [bodyArtifact],
				summary: "Timeline bodyfile generation failed.",
				warnings: flsResult.stderr ? [flsResult.stderr] : [],
				error: flsResult.error,
			});
		}

		const bodyPath = path.join(ctx.runDir, "timeline.body.raw");
		await writeFile(bodyPath, flsResult.stdout);
		const mactimeArgs = ["-b", bodyPath];
		const mactimeResult = await ctx.commandRunner("mactime", mactimeArgs);
		const timelineArtifact = await commandArtifact(
			ctx,
			"timeline.csv",
			"mactime",
			mactimeArgs,
			mactimeResult
		);

		const warnings = mactimeResult.stderr ? [mactimeResult.stderr] : [];
		if (autoOffsetWarning) warnings.unshift(autoOffsetWarning);

		return finalizeToolResult(ctx, "build_timeline", startedAt, input, {
			success: mactimeResult.success,
			artifacts: [bodyArtifact, timelineArtifact],
			summary: mactimeResult.success
				? autoOffsetWarning
					? `Built a filesystem timeline from fls bodyfile using auto-extracted partition offset ${offset}.`
					: "Built a filesystem timeline from fls bodyfile output."
				: "Bodyfile was created, but mactime conversion failed.",
			warnings,
			error: mactimeResult.error,
		});
	},

	search_indicators: async (ctx, input) => {
		const startedAt = ctx.now().toISOString();
		const indicators = Array.isArray(input.indicators)
			? input.indicators.map(String).filter(Boolean)
			: [];
		if (indicators.length === 0) {
			return finalizeToolResult(ctx, "search_indicators", startedAt, input, {
				success: false,
				artifacts: [],
				summary: "No indicators were provided.",
				warnings: [],
				error: "indicators must contain at least one string.",
			});
		}

		ctx.tracer?.logStep(
			"search_indicators",
			"Run strings",
			`Indicators: ${indicators.join(", ")}`,
			"Searching raw image for suspicious printable strings"
		);

		const commandResult = await ctx.commandRunner("strings", ["-a", ctx.imagePath], {
			timeoutMs: typeof input.timeoutMs === "number" ? input.timeoutMs : DEFAULT_TIMEOUT_MS,
		});
		const matches = indicators.map((indicator) => ({
			indicator,
			matches: commandResult.stdout
				.split(/\r?\n/)
				.filter((line) => line.toLowerCase().includes(indicator.toLowerCase()))
				.slice(0, 25),
		}));
		const artifact = await writeArtifact(
			ctx,
			"indicator-search.json",
			JSON.stringify(matches, null, 2)
		);

		ctx.tracer?.logStep(
			"search_indicators",
			"Indicator search complete",
			`Total matches: ${matches.reduce((s, m) => s + m.matches.length, 0)}`,
			"Matches capped at 25 per indicator to limit noise"
		);

		return finalizeToolResult(ctx, "search_indicators", startedAt, input, {
			success: commandResult.success,
			artifacts: [artifact],
			summary: commandResult.success
				? "Searched printable strings for supplied indicators and capped matches per indicator."
				: "Indicator search failed; verify strings is available and increase timeout if needed.",
			warnings: commandResult.stderr ? [commandResult.stderr] : [],
			error: commandResult.error,
		});
	},

	summarize_findings: async (ctx, input) => {
		const startedAt = ctx.now().toISOString();
		const logPath = path.join(ctx.runDir, "execution-log.ndjson");
		const log = await readFile(logPath, "utf8").catch(() => "");
		const notes = typeof input.notes === "string" ? input.notes : "";

		// Build execution trace for summary
		const executionTrace =
			log
				.split(/\r?\n/)
				.filter(Boolean)
				.map((line) => {
					const entry = JSON.parse(line) as FindEvilToolResult;
					return `- ${entry.finishedAt} ${entry.tool}: ${entry.success ? "success" : "failed"} - ${entry.summary}`;
				})
				.join("\n") || "No tool executions were logged.";

		// Build markdown first (no reasoning section yet; will be inserted after gate runs)
		const markdown = [
			`# ORPHEUS FIND EVIL Findings - ${ctx.caseId}`,
			"",
			`Evidence image: ${ctx.imagePath}`,
			`Run directory: ${ctx.runDir}`,
			"",
			"## Analyst Notes",
			notes || "No analyst notes supplied.",
			"",
			"## Tool Execution Trace",
			executionTrace,
			"",
			"## Evidence Integrity",
			"- Original image path was supplied externally and never written by ORPHEUS.",
			"- Generated artifacts include SHA-256 hashes in each tool result.",
			"- The full execution trace is stored as NDJSON beside these artifacts.",
		].join("\n");
		const artifact = await writeArtifact(ctx, "findings-summary.md", markdown);

		// Finalize so summarize_findings enters reasoningResults BEFORE gate runs
		const result = await finalizeToolResult(ctx, "summarize_findings", startedAt, input, {
			success: true,
			artifacts: [artifact],
			summary: "Generated a findings summary from the structured execution log.",
			warnings: [],
		});

		// ── Reasoning enhancements post-processing ──
		// NOW the gate sees summarize_findings in reasoningResults
		if (ctx.enableReasoning && ctx.reasoningResults) {
			// 3. Completion gate
			const gate = validateCompletionGate(ctx.reasoningResults);
			// 1. Self-check batch
			const selfCheck = selfCheckRun(ctx.reasoningResults);
			// 4. Persist & trend
			const persisted = persistCaseRun(ctx, ctx.reasoningResults, selfCheck, gate);
			const trend = autoCompareCase(persisted);

			// 2. Build case reasoning trace
			const toolTraces: ToolReasoningTrace[] = ctx.reasoningResults.map((r) =>
				ctx.tracer!.buildToolTrace(r.tool, r.selfCheck?.confidence ?? 1.0)
			);
			const caseTrace = ctx.tracer!.buildCaseTrace(selfCheck, {
				validated: gate.valid,
				expectedTools: gate.expectedTools,
				actualTools: gate.actualTools,
				missingTools: gate.missingTools,
			});
			caseTrace.toolTraces = toolTraces;
			caseTrace.finishedAt = new Date().toISOString();

			// 4. Write reasoning artifacts
			await writeReasoningArtifact(ctx, caseTrace);
			await writeSelfCheckArtifact(ctx, selfCheck);
			await writeCompletionGateArtifact(ctx, gate);
			if (trend) await writeTrendArtifact(ctx, trend);

			// 5. Executive
			await pushDfirTask(
				ctx.caseId,
				"findings_ready",
				"done",
				`Gate valid=${gate.valid}, confidence=${selfCheck.overallConfidence}`
			);
			await pushDfirTask(ctx.caseId, "artifacts_persisted", "done", `Artifacts in ${ctx.runDir}`);

			// Rewrite findings summary WITH reasoning section
			const reasoningSection = [
				"",
				"## Reasoning Enhancements",
				"",
				"### Completion Gate",
				`- Valid: ${gate.valid}`,
				`- Expected tools: ${gate.expectedTools}`,
				`- Actual tools: ${gate.actualTools}`,
				`- Missing: ${gate.missingTools.join(", ") || "none"}`,
				`- Warnings: ${gate.warnings.join("; ") || "none"}`,
				"",
				"### Self-Check",
				`- Overall valid: ${selfCheck.overallValid}`,
				`- Overall confidence: ${selfCheck.overallConfidence}`,
				`- Anomalies: ${selfCheck.anomalies.join("; ") || "none"}`,
				"",
				"### Trend Comparison",
				`- Trend: ${trend.trend}`,
				`- Success change: ${trend.successChange}`,
				`- Failure change: ${trend.failureChange}`,
				`- New failures: ${trend.newFailures.join(", ") || "none"}`,
				"",
			].join("\n");

			const updatedMarkdown = markdown.replace(
				"## Evidence Integrity",
				reasoningSection + "\n\n## Evidence Integrity"
			);
			await writeArtifact(ctx, "findings-summary.md", updatedMarkdown);
		}

		return result;
	},
};

export async function callFindEvilTool(
	ctx: FindEvilContext,
	tool: FindEvilToolName,
	input: Record<string, unknown>
): Promise<FindEvilToolResult> {
	const handler = findEvilToolHandlers[tool];
	if (!handler) throw new Error(`Unknown FIND EVIL tool: ${tool}`);
	return handler(ctx, input);
}
