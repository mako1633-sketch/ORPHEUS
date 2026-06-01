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
