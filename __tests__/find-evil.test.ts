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
});
