import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	appendPersistentContext,
	formatPersistentContextForPrompt,
	loadPersistentContext,
} from "../src/ai/persistent-context";
import { createNote, listNotes } from "../src/ai/tools/notes";
import { summarizeProjectContext } from "../src/ai/tools/project-context";

let tempConfigDir: string;
let previousConfigDir: string | undefined;

beforeEach(async () => {
	previousConfigDir = process.env.ORPHEUS_CONFIG_DIR;
	tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "orpheus-tools-"));
	process.env.ORPHEUS_CONFIG_DIR = tempConfigDir;
});

afterEach(async () => {
	if (previousConfigDir === undefined) {
		process.env.ORPHEUS_CONFIG_DIR = undefined;
	} else {
		process.env.ORPHEUS_CONFIG_DIR = previousConfigDir;
	}
	await rm(tempConfigDir, { recursive: true, force: true });
});

describe("assistant-style local tools", () => {
	it("creates and lists markdown notes in the ORPHEUS config directory", async () => {
		const created = await createNote({
			title: "Release ideas",
			content: "Port the useful assistant behaviors as native ORPHEUS tools.",
		});

		expect(created.success).toBe(true);
		expect(created.path).toContain(path.join(tempConfigDir, "notes"));

		const payload = await readFile(created.path!, "utf8");
		expect(payload).toContain("# Release ideas");
		expect(payload).toContain("native ORPHEUS tools");

		const listed = await listNotes({ count: 5 });
		expect(listed.success).toBe(true);
		expect(listed.notes).toHaveLength(1);
		expect(listed.notes?.[0]?.title).toBe("Release ideas");
	});

	it("stores persistent local context for future sessions without cloud keys", async () => {
		await appendPersistentContext("User prefers Ollama for ORPHEUS model routing.");

		const context = await loadPersistentContext();
		expect(context).toContain("User prefers Ollama");

		const promptContext = formatPersistentContextForPrompt(context);
		expect(promptContext).toContain("<persistent-context>");
		expect(promptContext).toContain("persists across ORPHEUS sessions");
		expect(promptContext).toContain("Ollama");
	});

	it("summarizes a local project for coding tasks", async () => {
		const projectDir = await mkdtemp(path.join(os.tmpdir(), "orpheus-project-context-"));
		try {
			await mkdir(path.join(projectDir, "src"));
			await writeFile(
				path.join(projectDir, "package.json"),
				JSON.stringify({
					name: "sample-app",
					scripts: { test: "bun test", check: "bun run typecheck" },
					dependencies: { react: "^19.0.0" },
					devDependencies: { typescript: "^5.0.0" },
				})
			);
			await writeFile(path.join(projectDir, "bun.lock"), "");
			await writeFile(path.join(projectDir, "tsconfig.json"), "{}");
			await writeFile(path.join(projectDir, "src", "index.ts"), "export const ok = true;\n");

			const summary = await summarizeProjectContext({ root: projectDir, maxFiles: 40 });

			expect(summary.success).toBe(true);
			if (!summary.success) throw new Error("project summary failed");
			expect(summary.packageManager).toBe("bun");
			expect(summary.package?.name).toBe("sample-app");
			expect(summary.package?.scripts?.test).toBe("bun test");
			expect(summary.importantFiles).toContain("package.json");
			expect(summary.importantFiles).toContain("tsconfig.json");
			expect(summary.files).toContain("src/");
			expect(summary.files).toContain("src/index.ts");
		} finally {
			await rm(projectDir, { recursive: true, force: true });
		}
	});
});
