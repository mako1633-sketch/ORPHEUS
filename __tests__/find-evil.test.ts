import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import {
	callFindEvilTool,
	createFindEvilContext,
	type CommandRunner,
	type CommandResult,
} from "../src/find-evil/core";
import { findEvilMcpTools } from "../src/find-evil/mcp-schema";
import {
	selfCheckToolResult,
	selfCheckRun,
	validateCompletionGate,
	createTriageTracer,
} from "../src/find-evil/reasoning-enhancements";

async function makeReadOnlyImage(tmp: string) {
	const imagePath = path.join(tmp, "case.dd");
	await writeFile(imagePath, "powershell\nrundll32\nnormal\n");
	await chmod(imagePath, 0o444);
	return imagePath;
}

function mockRunner(calls: Array<{ command: string; args: string[] }>): CommandRunner {
	return async (command, args): Promise<CommandResult> => {
		calls.push({ command, args });
		if (command === "mmls") {
			return {
				success: true,
				exitCode: 0,
				command,
				args,
				stdout: "000: Meta 0000000000 0000000000 Primary Table",
				stderr: "",
			};
		}
		if (command === "fls") {
			return {
				success: true,
				exitCode: 0,
				command,
				args,
				stdout: "r/r 5-128-1: Windows/System32/cmd.exe",
				stderr: "",
			};
		}
		if (command === "istat") {
			return {
				success: true,
				exitCode: 0,
				command,
				args,
				stdout: "inode: 5\nAllocated",
				stderr: "",
			};
		}
		if (command === "mactime") {
			return {
				success: true,
				exitCode: 0,
				command,
				args,
				stdout: "Date,Size,Type,Mode,UID,GID,Meta,File Name",
				stderr: "",
			};
		}
		if (command === "strings") {
			return {
				success: true,
				exitCode: 0,
				command,
				args,
				stdout: "powershell -nop\nrundll32 suspicious.dll",
				stderr: "",
			};
		}
		return { success: false, exitCode: 1, command, args, stdout: "", stderr: "missing" };
	};
}

describe("FIND EVIL SIFT MCP readiness", () => {
	it("defines the required typed MCP tools", () => {
		expect(findEvilMcpTools.map((tool) => tool.name)).toEqual([
			"hash_evidence",
			"inspect_partitions",
			"list_files",
			"extract_file_metadata",
			"build_timeline",
			"search_indicators",
			"summarize_findings",
		]);
		expect(findEvilMcpTools.every((tool) => tool.inputSchema.type === "object")).toBe(true);
	});

	it("rejects missing, relative, and writable evidence image paths", async () => {
		await expect(createFindEvilContext({ imagePath: "case.dd" })).rejects.toThrow(
			"must be absolute"
		);
		await expect(
			createFindEvilContext({ imagePath: path.join(os.tmpdir(), "missing.dd") })
		).rejects.toThrow("does not exist");

		const tmp = await mkdtemp(path.join(os.tmpdir(), "orpheus-find-evil-"));
		const writable = path.join(tmp, "writable.dd");
		await writeFile(writable, "fixture");
		await expect(createFindEvilContext({ imagePath: writable, outputDir: tmp })).rejects.toThrow(
			"Evidence image is writable"
		);
	});

	it("hashes evidence, writes artifacts, and appends structured logs", async () => {
		const tmp = await mkdtemp(path.join(os.tmpdir(), "orpheus-find-evil-"));
		const imagePath = await makeReadOnlyImage(tmp);
		const ctx = await createFindEvilContext({
			imagePath,
			caseId: "Case 001",
			outputDir: path.join(tmp, "runs"),
		});

		const result = await callFindEvilTool(ctx, "hash_evidence", {});
		expect(result.success).toBe(true);
		expect(result.caseId).toBe("case-001");
		expect(result.artifacts[0]?.sha256).toHaveLength(64);

		const log = await readFile(path.join(ctx.runDir, "execution-log.ndjson"), "utf8");
		const logged = JSON.parse(log.trim());
		expect(logged.tool).toBe("hash_evidence");
		expect(logged.artifacts[0].sha256).toHaveLength(64);
	});

	it("runs mocked SIFT commands for disk-image triage tools", async () => {
		const tmp = await mkdtemp(path.join(os.tmpdir(), "orpheus-find-evil-"));
		const imagePath = await makeReadOnlyImage(tmp);
		const calls: Array<{ command: string; args: string[] }> = [];
		const ctx = await createFindEvilContext(
			{ imagePath, caseId: "triage", outputDir: path.join(tmp, "runs") },
			{ commandRunner: mockRunner(calls) }
		);

		expect((await callFindEvilTool(ctx, "inspect_partitions", {})).success).toBe(true);
		expect((await callFindEvilTool(ctx, "list_files", { offset: 2048 })).success).toBe(true);
		expect(
			(await callFindEvilTool(ctx, "extract_file_metadata", { inode: "5", offset: 2048 })).success
		).toBe(true);
		expect((await callFindEvilTool(ctx, "build_timeline", { offset: 2048 })).success).toBe(true);
		expect(
			(await callFindEvilTool(ctx, "search_indicators", { indicators: ["powershell"] })).success
		).toBe(true);

		expect(calls.map((call) => call.command)).toEqual([
			"mmls",
			"fls",
			"istat",
			"fls",
			"mactime",
			"strings",
		]);
		expect(calls[1]?.args).toContain("2048");
	});

	it("auto-extracts partition offset for list_files when no offset is provided", async () => {
		const tmp = await mkdtemp(path.join(os.tmpdir(), "orpheus-find-evil-"));
		const imagePath = await makeReadOnlyImage(tmp);
		const calls: Array<{ command: string; args: string[] }> = [];
		const ctx = await createFindEvilContext(
			{ imagePath, caseId: "auto-offset", outputDir: path.join(tmp, "runs") },
			{ commandRunner: mockRunner(calls) }
		);

		// Simulate a prior inspect_partitions that wrote partitions.txt with a data partition
		await writeFile(
			path.join(ctx.runDir, "partitions.txt"),
			[
				"$ mmls /abs/case.dd",
				"exitCode: 0",
				"",
				"## stdout",
				"DOS Partition Table",
				"Offset Sector: 0",
				"Units are in 512-byte sectors",
				"     Slot    Start        End          Length       Description",
				"00:  -----   0000000000   0000002047   0000002048   Primary Table (#0)",
				"01:  00:00   0000002048   0000974847   0000972800   Linux (0x83)",
				"02:  00:01   0000974848   0001953791   0000978944   Extended Partition (0x05)",
			].join("\n")
		);

		const result = await callFindEvilTool(ctx, "list_files", {});
		expect(result.success).toBe(true);
		expect(result.warnings?.some((w) => w.includes("Auto-extracted partition offset 2048"))).toBe(
			true
		);
		expect(result.summary).toContain("auto-extracted partition offset 2048");

		// Find the fls call and verify it used the auto-extracted offset
		const flsCall = calls.find((c) => c.command === "fls");
		expect(flsCall).toBeDefined();
		expect(flsCall?.args).toContain("-o");
		expect(flsCall?.args).toContain("2048");
	});

	it("auto-extracts partition offset for build_timeline when no offset is provided", async () => {
		const tmp = await mkdtemp(path.join(os.tmpdir(), "orpheus-find-evil-"));
		const imagePath = await makeReadOnlyImage(tmp);
		const calls: Array<{ command: string; args: string[] }> = [];
		const ctx = await createFindEvilContext(
			{ imagePath, caseId: "auto-timeline", outputDir: path.join(tmp, "runs") },
			{ commandRunner: mockRunner(calls) }
		);

		// Simulate a prior inspect_partitions result
		await writeFile(
			path.join(ctx.runDir, "partitions.txt"),
			[
				"## stdout",
				"     Slot    Start        End          Length       Description",
				"01:  00:00   0000002048   0000974847   0000972800   Linux (0x83)",
			].join("\n")
		);

		const result = await callFindEvilTool(ctx, "build_timeline", {});
		expect(result.success).toBe(true);
		expect(result.warnings?.some((w) => w.includes("Auto-extracted partition offset 2048"))).toBe(
			true
		);
		expect(result.summary).toContain("auto-extracted partition offset 2048");

		// Verify fls was called with the auto-extracted offset
		const flsCall = calls.find((c) => c.command === "fls");
		expect(flsCall).toBeDefined();
		expect(flsCall?.args).toContain("-o");
		expect(flsCall?.args).toContain("2048");
	});

	it("prefers explicit offset over auto-extracted offset", async () => {
		const tmp = await mkdtemp(path.join(os.tmpdir(), "orpheus-find-evil-"));
		const imagePath = await makeReadOnlyImage(tmp);
		const calls: Array<{ command: string; args: string[] }> = [];
		const ctx = await createFindEvilContext(
			{ imagePath, caseId: "explicit-offset", outputDir: path.join(tmp, "runs") },
			{ commandRunner: mockRunner(calls) }
		);

		await writeFile(
			path.join(ctx.runDir, "partitions.txt"),
			["## stdout", "01:  00:00   0000002048   0000974847   0000972800   Linux (0x83)"].join("\n")
		);

		const result = await callFindEvilTool(ctx, "list_files", { offset: 4096 });
		expect(result.success).toBe(true);
		expect(result.warnings?.some((w) => w.includes("Auto-extracted"))).toBe(false);

		const flsCall = calls.find((c) => c.command === "fls");
		expect(flsCall?.args).toContain("4096");
		expect(flsCall?.args).not.toContain("2048");
	});

	it("gracefully falls back when partitions.txt is missing and no offset is given", async () => {
		const tmp = await mkdtemp(path.join(os.tmpdir(), "orpheus-find-evil-"));
		const imagePath = await makeReadOnlyImage(tmp);
		const calls: Array<{ command: string; args: string[] }> = [];
		const ctx = await createFindEvilContext(
			{ imagePath, caseId: "no-offset", outputDir: path.join(tmp, "runs") },
			{ commandRunner: mockRunner(calls) }
		);

		// partitions.txt does not exist — auto-extraction should silently skip
		const result = await callFindEvilTool(ctx, "list_files", {});
		expect(result.success).toBe(true);
		expect(result.warnings?.some((w) => w.includes("Auto-extracted"))).toBe(false);

		// fls should be called without -o
		const flsCall = calls.find((c) => c.command === "fls");
		expect(flsCall).toBeDefined();
		expect(flsCall?.args).not.toContain("-o");
	});
});

describe("FIND EVIL Reasoning Enhancements", () => {
	it("self-check flags suspicious empty output and missing artifacts", () => {
		const result = {
			success: true,
			caseId: "test",
			tool: "list_files" as const,
			startedAt: new Date().toISOString(),
			finishedAt: new Date().toISOString(),
			inputs: {},
			artifacts: [],
			summary: "",
			warnings: [],
		};
		const check = selfCheckToolResult(result);
		expect(check.valid).toBe(true);
		expect(check.warnings.length).toBeGreaterThanOrEqual(2);
		expect(check.warnings.some((w) => w.includes("Expected at least 1 artifact"))).toBe(true);
		expect(check.warnings.some((w) => w.includes("summary is empty"))).toBe(true);
		expect(check.confidence).toBeLessThan(1.0);
	});

	it("self-check detects failed tool without error message", () => {
		const result = {
			success: false,
			caseId: "test",
			tool: "inspect_partitions" as const,
			startedAt: new Date().toISOString(),
			finishedAt: new Date().toISOString(),
			inputs: {},
			artifacts: [],
			summary: "Partition inspection failed",
			warnings: [],
		};
		const check = selfCheckToolResult(result);
		expect(check.valid).toBe(false);
		expect(check.issues.some((i) => i.includes("failed but no error message"))).toBe(true);
	});

	it("completion gate detects missing and duplicate tools", () => {
		const results = [
			{ tool: "hash_evidence", success: true },
			{ tool: "inspect_partitions", success: true },
			{ tool: "list_files", success: true },
			{ tool: "list_files", success: true }, // duplicate
			{ tool: "search_indicators", success: true },
			{ tool: "summarize_findings", success: true },
		] as unknown as import("../src/find-evil/types").FindEvilToolResult[];

		const gate = validateCompletionGate(results);
		expect(gate.valid).toBe(false);
		expect(gate.missingTools).toContain("extract_file_metadata");
		expect(gate.missingTools).toContain("build_timeline");
		expect(gate.duplicateTools).toContain("list_files");
		expect(gate.warnings.length).toBeGreaterThanOrEqual(2);
	});

	it("completion gate passes for complete 7-tool run", () => {
		const results = [
			{ tool: "hash_evidence", success: true },
			{ tool: "inspect_partitions", success: true },
			{ tool: "list_files", success: true },
			{ tool: "extract_file_metadata", success: true },
			{ tool: "build_timeline", success: true },
			{ tool: "search_indicators", success: true },
			{ tool: "summarize_findings", success: true },
		] as unknown as import("../src/find-evil/types").FindEvilToolResult[];

		const gate = validateCompletionGate(results);
		expect(gate.valid).toBe(true);
		expect(gate.missingTools).toEqual([]);
		expect(gate.duplicateTools).toEqual([]);
	});

	it("self-check run detects duplicate tool executions and out-of-order runs", () => {
		const results = [
			{
				success: true,
				caseId: "test",
				tool: "hash_evidence" as const,
				startedAt: "2024-01-01T00:00:00Z",
				finishedAt: "2024-01-01T00:00:01Z",
				inputs: {},
				artifacts: [{ path: "/a", sha256: "x".repeat(64), bytes: 1 }],
				summary: "ok",
				warnings: [],
			},
			{
				success: true,
				caseId: "test",
				tool: "summarize_findings" as const,
				startedAt: "2024-01-01T00:00:02Z",
				finishedAt: "2024-01-01T00:00:03Z",
				inputs: {},
				artifacts: [{ path: "/b", sha256: "x".repeat(64), bytes: 1 }],
				summary: "ok",
				warnings: [],
			},
			{
				success: true,
				caseId: "test",
				tool: "inspect_partitions" as const,
				startedAt: "2024-01-01T00:00:04Z",
				finishedAt: "2024-01-01T00:00:05Z",
				inputs: {},
				artifacts: [{ path: "/c", sha256: "x".repeat(64), bytes: 1 }],
				summary: "ok",
				warnings: [],
			},
		];

		const runCheck = selfCheckRun(results);
		expect(runCheck.overallValid).toBe(true);
		expect(runCheck.anomalies.some((a) => a.includes("Out-of-order"))).toBe(true);
	});

	it("emits reasoning trace artifact when enableReasoning is true", async () => {
		const tmp = await mkdtemp(path.join(os.tmpdir(), "orpheus-find-evil-"));
		const imagePath = await makeReadOnlyImage(tmp);
		const calls: Array<{ command: string; args: string[] }> = [];
		const ctx = await createFindEvilContext(
			{
				imagePath,
				caseId: "reasoning-test",
				outputDir: path.join(tmp, "runs"),
				enableReasoning: true,
			},
			{ commandRunner: mockRunner(calls) }
		);

		expect(ctx.enableReasoning).toBe(true);
		expect(ctx.tracer).toBeDefined();
		expect(ctx.reasoningResults).toBeDefined();

		await callFindEvilTool(ctx, "hash_evidence", {});
		await callFindEvilTool(ctx, "inspect_partitions", {});
		await callFindEvilTool(ctx, "list_files", { offset: 2048 });
		await callFindEvilTool(ctx, "extract_file_metadata", { inode: "5", offset: 2048 });
		await callFindEvilTool(ctx, "build_timeline", { offset: 2048 });
		await callFindEvilTool(ctx, "search_indicators", { indicators: ["powershell"] });
		await callFindEvilTool(ctx, "summarize_findings", { notes: "reasoning test" });

		// Verify reasoning artifacts exist
		const reasoningTrace = await readFile(
			path.join(ctx.runDir, "reasoning-trace.json"),
			"utf8"
		).catch(() => null);
		const selfCheckArtifact = await readFile(
			path.join(ctx.runDir, "self-check.json"),
			"utf8"
		).catch(() => null);
		const gateArtifact = await readFile(
			path.join(ctx.runDir, "completion-gate.json"),
			"utf8"
		).catch(() => null);
		const trendArtifact = await readFile(
			path.join(ctx.runDir, "trend-comparison.json"),
			"utf8"
		).catch(() => null);

		expect(reasoningTrace).not.toBeNull();
		expect(selfCheckArtifact).not.toBeNull();
		expect(gateArtifact).not.toBeNull();
		expect(trendArtifact).not.toBeNull();

		const trace = JSON.parse(reasoningTrace!);
		expect(trace.caseId).toBe("reasoning-test");
		expect(trace.toolTraces.length).toBe(7);
		expect(trace.completionGate.validated).toBe(true);
		expect(trace.completionGate.expectedTools).toBe(7);
		expect(trace.completionGate.actualTools).toBe(7);
		expect(trace.completionGate.missingTools).toEqual([]);

		const gate = JSON.parse(gateArtifact!);
		expect(gate.valid).toBe(true);

		const sc = JSON.parse(selfCheckArtifact!);
		expect(sc.overallValid).toBe(true);
		expect(sc.overallConfidence).toBeGreaterThan(0);
	});

	it("selfCheck is populated on each tool result when reasoning enabled", async () => {
		const tmp = await mkdtemp(path.join(os.tmpdir(), "orpheus-find-evil-"));
		const imagePath = await makeReadOnlyImage(tmp);
		const ctx = await createFindEvilContext(
			{
				imagePath,
				caseId: "selfcheck-test",
				outputDir: path.join(tmp, "runs"),
				enableReasoning: true,
			},
			{ commandRunner: mockRunner([]) }
		);

		const result = await callFindEvilTool(ctx, "hash_evidence", {});
		expect(result.selfCheck).toBeDefined();
		expect(result.selfCheck!.valid).toBe(true);
		expect(result.selfCheck!.confidence).toBeGreaterThan(0);
	});

	it("does not emit reasoning artifacts when enableReasoning is false", async () => {
		const tmp = await mkdtemp(path.join(os.tmpdir(), "orpheus-find-evil-"));
		const imagePath = await makeReadOnlyImage(tmp);
		const ctx = await createFindEvilContext(
			{
				imagePath,
				caseId: "no-reasoning",
				outputDir: path.join(tmp, "runs"),
				enableReasoning: false,
			},
			{ commandRunner: mockRunner([]) }
		);

		await callFindEvilTool(ctx, "hash_evidence", {});
		await callFindEvilTool(ctx, "summarize_findings", {});

		const reasoningTrace = await readFile(
			path.join(ctx.runDir, "reasoning-trace.json"),
			"utf8"
		).catch(() => null);
		expect(reasoningTrace).toBeNull();
		expect(ctx.tracer).toBeUndefined();
	});

	it("triage tracer captures partition-offset reasoning steps", () => {
		const tracer = createTriageTracer("tracer-test");
		tracer.logStep("list_files", "Attempt auto-extract", "No offset given", "Check partitions.txt");
		tracer.logStep(
			"list_files",
			"Auto-extracted offset",
			"offset=2048",
			"Use first data partition"
		);
		const trace = tracer.buildToolTrace("list_files", 0.95);
		expect(trace.steps.length).toBe(2);
		expect(trace.steps[0].action).toBe("Attempt auto-extract");
		expect(trace.steps[1].observation).toBe("offset=2048");
		expect(trace.confidence).toBe(0.95);
	});

	it("trend comparison classifies first run as stable", async () => {
		const tmp = await mkdtemp(path.join(os.tmpdir(), "orpheus-find-evil-"));
		const imagePath = await makeReadOnlyImage(tmp);
		const calls: Array<{ command: string; args: string[] }> = [];
		const ctx = await createFindEvilContext(
			{
				imagePath,
				caseId: "trend-test",
				outputDir: path.join(tmp, "runs"),
				enableReasoning: true,
			},
			{ commandRunner: mockRunner(calls) }
		);

		await callFindEvilTool(ctx, "hash_evidence", {});
		await callFindEvilTool(ctx, "inspect_partitions", {});
		await callFindEvilTool(ctx, "list_files", { offset: 2048 });
		await callFindEvilTool(ctx, "extract_file_metadata", { inode: "5", offset: 2048 });
		await callFindEvilTool(ctx, "build_timeline", { offset: 2048 });
		await callFindEvilTool(ctx, "search_indicators", { indicators: ["powershell"] });
		await callFindEvilTool(ctx, "summarize_findings", { notes: "trend test" });

		const trend = await readFile(path.join(ctx.runDir, "trend-comparison.json"), "utf8");
		const parsed = JSON.parse(trend);
		expect(parsed.trend).toBe("stable");
		expect(parsed.previous).toBeUndefined();
	});
});
