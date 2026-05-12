import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	appendPersistentContext,
	formatPersistentContextForPrompt,
	loadPersistentContext,
} from "../src/ai/persistent-context";
import { loadCodingTaskState, updateCodingTaskState } from "../src/ai/coding-task-state";
import { addExecutiveItem, buildExecutiveBriefing, updateExecutiveItem } from "../src/ai/executive-state";
import { codingWorkbench } from "../src/ai/tools/coding-workbench";
import { executiveAssistant } from "../src/ai/tools/executive-assistant";
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

	it("persists coding task state for interrupted repo work", async () => {
		await updateCodingTaskState({
			goal: "Fix CLI startup",
			filesInspected: ["src/cli.ts"],
			filesChanged: ["src/cli.ts"],
			checksRun: ["bun run check"],
			failures: ["format failed"],
			nextStep: "Run formatter and retry check",
		});

		const state = await loadCodingTaskState();
		expect(state?.goal).toBe("Fix CLI startup");
		expect(state?.filesInspected).toContain("src/cli.ts");
		expect(state?.failures).toContain("format failed");
		expect(state?.nextStep).toBe("Run formatter and retry check");
	});

	it("discovers validation scripts through the coding workbench", async () => {
		const projectDir = await mkdtemp(path.join(os.tmpdir(), "orpheus-coding-workbench-"));
		try {
			await writeFile(
				path.join(projectDir, "package.json"),
				JSON.stringify({
					name: "sample-workbench",
					scripts: {
						check: "bun run typecheck",
						typecheck: "tsc --noEmit",
						test: "bun test",
						dev: "bun run --watch src/index.ts",
					},
				})
			);
			await writeFile(path.join(projectDir, "bun.lock"), "");

			const result = await (
				codingWorkbench as unknown as {
					execute: (input: unknown) => Promise<{
						success: boolean;
						packageManager?: string;
						recommendedValidation?: string[];
					}>;
				}
			).execute({ action: "packageScripts", root: projectDir });

			expect(result.success).toBe(true);
			expect(result.packageManager).toBe("bun");
			expect(result.recommendedValidation).toEqual(["check", "typecheck", "test"]);
		} finally {
			await rm(projectDir, { recursive: true, force: true });
		}
	});

	it("explains common coding command failures", async () => {
		const result = await (
			codingWorkbench as unknown as {
				execute: (input: unknown) => Promise<{
					success: boolean;
					likelyCause?: string;
					signals?: string[];
				}>;
			}
		).execute({
			action: "explainFailure",
			command: "bun run typecheck",
			output: "src/index.ts(1,1): error TS2307: Cannot find module './missing'",
		});

		expect(result.success).toBe(true);
		expect(result.signals).toContain("module-resolution");
		expect(result.likelyCause).toContain("dependency");
	});

	it("tracks executive follow-ups and builds a briefing", async () => {
		const followUp = await addExecutiveItem({
			kind: "follow_up",
			title: "Send ORPHEUS GitHub status note",
			owner: "Matt",
			dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
			context: "Confirm local and GitHub repos are in sync.",
		});
		await addExecutiveItem({
			kind: "risk",
			title: "Provider context can overflow on long sessions",
			context: "Watch for HTTP 400 prompt-too-long failures.",
		});

		const updated = await updateExecutiveItem({ id: followUp.item.id, status: "blocked" });
		expect(updated.found).toBe(true);
		expect(updated.item?.status).toBe("blocked");

		const briefing = await buildExecutiveBriefing();
		expect(briefing.counts.follow_up).toBe(1);
		expect(briefing.counts.risk).toBe(1);
		expect(briefing.upcoming.some((item) => item.title.includes("GitHub status"))).toBe(true);
	});

	it("exposes executive assistant tool actions", async () => {
		const captured = await (
			executiveAssistant as unknown as {
				execute: (input: unknown) => Promise<{
					success: boolean;
					item?: { id: string; title: string };
				}>;
			}
		).execute({
			action: "capture",
			kind: "decision",
			title: "Use local-first executive state",
			context: "Avoid pretending to have calendar/email access.",
		});

		expect(captured.success).toBe(true);
		expect(captured.item?.title).toBe("Use local-first executive state");

		const briefing = await (
			executiveAssistant as unknown as {
				execute: (input: unknown) => Promise<{
					success: boolean;
					briefing?: { counts: { decision: number } };
				}>;
			}
		).execute({ action: "briefing" });

		expect(briefing.success).toBe(true);
		expect(briefing.briefing?.counts.decision).toBe(1);
	});
});
