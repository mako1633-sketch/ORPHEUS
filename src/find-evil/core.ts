import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FindEvilArtifact, FindEvilToolName, FindEvilToolResult } from "./types";

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
}

export interface FindEvilContext {
	imagePath: string;
	caseId: string;
	outputDir: string;
	runDir: string;
	allowWritableImage: boolean;
	commandRunner: CommandRunner;
	now: () => Date;
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

	return {
		imagePath,
		caseId,
		outputDir,
		runDir,
		allowWritableImage,
		commandRunner: options.commandRunner ?? runCommand,
		now: options.now ?? (() => new Date()),
	};
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
	await appendExecutionLog(ctx, result);
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
		const artifact = await writeArtifact(
			ctx,
			"evidence-hash.json",
			JSON.stringify({ imagePath: ctx.imagePath, ...(await sha256File(ctx.imagePath)) }, null, 2)
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
		const command = "mmls";
		const args = [ctx.imagePath];
		const commandResult = await ctx.commandRunner(command, args);
		const artifact = await commandArtifact(ctx, "partitions.txt", command, args, commandResult);
		return finalizeToolResult(ctx, "inspect_partitions", startedAt, input, {
			success: commandResult.success,
			artifacts: [artifact],
			summary: commandResult.success
				? "Inspected disk image partition layout with mmls."
				: "Partition inspection failed; verify SIFT sleuthkit tools are installed.",
			warnings: commandResult.stderr ? [commandResult.stderr] : [],
			error: commandResult.error,
		});
	},

	list_files: async (ctx, input) => {
		const startedAt = ctx.now().toISOString();
		let offset = typeof input.offset === "number" ? String(input.offset) : undefined;
		let autoOffsetWarning: string | undefined;

		if (!offset) {
			const autoOffset = await readAutoPartitionOffset(ctx);
			if (autoOffset !== undefined) {
				offset = String(autoOffset);
				autoOffsetWarning = `Auto-extracted partition offset ${autoOffset} from prior inspect_partitions result.`;
			}
		}

		const command = "fls";
		const args = ["-r", "-p", ...(offset ? ["-o", offset] : []), ctx.imagePath];
		const commandResult = await ctx.commandRunner(command, args);
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
			log
				.split(/\r?\n/)
				.filter(Boolean)
				.map((line) => {
					const entry = JSON.parse(line) as FindEvilToolResult;
					return `- ${entry.finishedAt} ${entry.tool}: ${entry.success ? "success" : "failed"} - ${entry.summary}`;
				})
				.join("\n") || "No tool executions were logged.",
			"",
			"## Evidence Integrity",
			"- Original image path was supplied externally and never written by ORPHEUS.",
			"- Generated artifacts include SHA-256 hashes in each tool result.",
			"- The full execution trace is stored as NDJSON beside these artifacts.",
		].join("\n");
		const artifact = await writeArtifact(ctx, "findings-summary.md", markdown);
		return finalizeToolResult(ctx, "summarize_findings", startedAt, input, {
			success: true,
			artifacts: [artifact],
			summary: "Generated a findings summary from the structured execution log.",
			warnings: [],
		});
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
