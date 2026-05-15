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
import { loadTaskStack } from "../src/ai/task-stack-state";
import { loadReflections } from "../src/ai/reflection-state";
import { codingWorkbench } from "../src/ai/tools/coding-workbench";
import { daemonStatus } from "../src/ai/tools/daemon-status";
import { executiveAssistant } from "../src/ai/tools/executive-assistant";
import { createNote, listNotes } from "../src/ai/tools/notes";
import { persistentContext as persistentContextTool } from "../src/ai/tools/persistent-context";
import { summarizeProjectContext } from "../src/ai/tools/project-context";
import { writeFile as writeFileTool } from "../src/ai/tools/write-file";

let tempConfigDir: string;
let previousConfigDir: string | undefined;
let previousHonchoEnabled: string | undefined;
let previousHonchoApiKey: string | undefined;
let previousHonchoBaseUrl: string | undefined;

function restoreEnvValue(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
}

beforeEach(async () => {
	previousConfigDir = process.env.ORPHEUS_CONFIG_DIR;
	previousHonchoEnabled = process.env.HONCHO_ENABLED;
	previousHonchoApiKey = process.env.HONCHO_API_KEY;
	previousHonchoBaseUrl = process.env.HONCHO_BASE_URL;
	tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "orpheus-tools-"));
	process.env.ORPHEUS_CONFIG_DIR = tempConfigDir;
	process.env.HONCHO_ENABLED = undefined;
	process.env.HONCHO_API_KEY = undefined;
	process.env.HONCHO_BASE_URL = undefined;
});

afterEach(async () => {
	if (previousConfigDir === undefined) {
		process.env.ORPHEUS_CONFIG_DIR = undefined;
	} else {
		process.env.ORPHEUS_CONFIG_DIR = previousConfigDir;
	}
	restoreEnvValue("HONCHO_ENABLED", previousHonchoEnabled);
	restoreEnvValue("HONCHO_API_KEY", previousHonchoApiKey);
	restoreEnvValue("HONCHO_BASE_URL", previousHonchoBaseUrl);
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

	it("exposes persistent context control-center actions", async () => {
		await appendPersistentContext("Pin ORPHEUS quality dashboard preferences.");
		const read = await (
			persistentContextTool as unknown as {
				execute: (input: unknown) => Promise<{
					success: boolean;
					controlCenter?: { preview: string[]; actions: string[] };
				}>;
			}
		).execute({ action: "read" });

		expect(read.success).toBe(true);
		expect(read.controlCenter?.actions).toContain("export");
		expect(read.controlCenter?.preview.join("\n")).toContain("quality dashboard");

		const exported = await (
			persistentContextTool as unknown as {
				execute: (input: unknown) => Promise<{ success: boolean; path?: string; empty?: boolean }>;
			}
		).execute({ action: "export" });
		expect(exported.success).toBe(true);
		expect(exported.empty).toBe(false);
		expect(exported.path).toContain("persistent-context-export");

		const cleared = await (
			persistentContextTool as unknown as {
				execute: (input: unknown) => Promise<{ success: boolean; cleared?: boolean }>;
			}
		).execute({ action: "clear" });
		expect(cleared.success).toBe(true);
		expect(cleared.cleared).toBe(true);
		expect(await loadPersistentContext()).toBe("");
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
			evidence: ["Observed CLI startup exits before first prompt"],
			assumptions: ["The installed shell is zsh"],
			risks: ["Startup fixes can regress macOS path handling"],
			nextStep: "Run formatter and retry check",
		});

		const state = await loadCodingTaskState();
		expect(state?.goal).toBe("Fix CLI startup");
		expect(state?.filesInspected).toContain("src/cli.ts");
		expect(state?.failures).toContain("format failed");
		expect(state?.evidence).toContain("Observed CLI startup exits before first prompt");
		expect(state?.assumptions).toContain("The installed shell is zsh");
		expect(state?.risks).toContain("Startup fixes can regress macOS path handling");
		expect(state?.nextStep).toBe("Run formatter and retry check");
	});

	it("writes completed coding lessons to long-term memory", async () => {
		const result = await (
			codingWorkbench as unknown as {
				execute: (input: unknown) => Promise<{ success: boolean; state?: { status: string } }>;
			}
		).execute({
			action: "taskState",
			mode: "save",
			goal: "Improve failure recovery",
			status: "completed",
			filesChanged: ["src/ai/tools/coding-workbench.ts"],
			checksRun: ["bun test __tests__/assistant-tools.test.ts"],
			failures: ["Initial broad retry policy hid deterministic failures"],
			evidence: ["Added pivot strategy for deterministic failures"],
			assumptions: ["Transient provider errors can be retried once"],
			risks: ["Failure handling can create retry loops"],
		});

		expect(result.success).toBe(true);
		expect(result.state?.status).toBe("completed");

		const reflections = await loadReflections();
		const latest = reflections.entries.at(-1);
		expect(latest?.goal).toBe("Improve failure recovery");
		expect(latest?.whatWorked).toContain("Added pivot strategy for deterministic failures");
		expect(latest?.whatFailed).toContain("Initial broad retry policy hid deterministic failures");

		const persistentContext = await loadPersistentContext();
		expect(persistentContext).toContain("ORPHEUS learned from coding task");
		expect(persistentContext).toContain("Reuse: Added pivot strategy");
		expect(persistentContext).toContain("Watch for: Initial broad retry policy");
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

	it("builds an adversarial coding self-review", async () => {
		const result = await (
			codingWorkbench as unknown as {
				execute: (input: unknown) => Promise<{
					success: boolean;
					evidence?: string[];
					inferences?: string[];
					risks?: string[];
					recommendedChecks?: string[];
					completionGate?: string[];
				}>;
			}
		).execute({
			action: "selfReview",
			goal: "Make write-file receipts truthful",
			changedFiles: ["src/ai/tools/write-file.ts", "__tests__/assistant-tools.test.ts"],
			diff: "fs.writeFileSync(resolvedPath, content); const after = fs.readFileSync(resolvedPath)",
			checksRun: ["bun test __tests__/assistant-tools.test.ts"],
			validationScripts: ["typecheck", "test"],
		});

		expect(result.success).toBe(true);
		expect(result.evidence?.join("\n")).toContain("Make write-file receipts truthful");
		expect(result.inferences?.join("\n")).toContain("Risk tags inferred");
		expect(result.risks?.join("\n")).toContain("Filesystem side effects");
		expect(result.recommendedChecks).toContain("typecheck");
		expect(result.completionGate?.join("\n")).toContain("readback");
	});

	it("blocks coding completion when evidence is missing", async () => {
		const result = await (
			codingWorkbench as unknown as {
				execute: (input: unknown) => Promise<{
					success: boolean;
					ready?: boolean;
					blockers?: string[];
					requiredEvidence?: string[];
					recommendedNextActions?: string[];
				}>;
			}
		).execute({
			action: "completionGate",
			goal: "Tighten Codex coding behavior",
			changedFiles: ["src/ai/system-prompt.ts", "src/ai/providers/copilot-provider.ts"],
			checksRun: ["bun test __tests__/system-prompt.test.ts"],
		});

		expect(result.success).toBe(true);
		expect(result.ready).toBe(false);
		expect(result.blockers?.join("\n")).toContain("typecheck");
		expect(result.requiredEvidence?.join("\n")).toContain("regression test");
		expect(result.recommendedNextActions?.join("\n")).toContain("typecheck");
	});

	it("runs project doctor and coding mode QoL actions", async () => {
		const projectDir = await mkdtemp(path.join(os.tmpdir(), "orpheus-project-doctor-"));
		try {
			await writeFile(
				path.join(projectDir, "package.json"),
				JSON.stringify({
					name: "doctor-app",
					scripts: { check: "bun run typecheck", test: "bun test" },
				})
			);
			await writeFile(path.join(projectDir, "bun.lock"), "");
			await writeFile(path.join(projectDir, "README.md"), "# Doctor App\n");

			const doctor = await (
				codingWorkbench as unknown as {
					execute: (input: unknown) => Promise<{
						success: boolean;
						checks?: Array<{ id: string; status: string }>;
						recommendedNextActions?: string[];
					}>;
				}
			).execute({ action: "projectDoctor", root: projectDir });
			expect(doctor.success).toBe(true);
			expect(doctor.checks?.find((check) => check.id === "validation")?.status).toBe("ok");

			const profile = await (
				codingWorkbench as unknown as {
					execute: (input: unknown) => Promise<{
						success: boolean;
						profile?: string;
						validationBias?: string[];
					}>;
				}
			).execute({ action: "modeProfile", profile: "releasePrep" });
			expect(profile.success).toBe(true);
			expect(profile.validationBias).toContain("build");
		} finally {
			await rm(projectDir, { recursive: true, force: true });
		}
	});

	it("builds GitHub publish and failure recovery plans", async () => {
		const publish = await (
			codingWorkbench as unknown as {
				execute: (input: unknown) => Promise<{
					success: boolean;
					steps?: string[];
					secretChecks?: string[];
					requiresApproval?: string[];
				}>;
			}
		).execute({ action: "githubPublishPlan", root: process.cwd(), repoName: "ORPHEUS" });
		expect(publish.success).toBe(true);
		expect(publish.secretChecks?.join("\n")).toContain(".env");
		expect(publish.requiresApproval).toContain("Pushing to GitHub");

		const recovery = await (
			codingWorkbench as unknown as {
				execute: (input: unknown) => Promise<{
					success: boolean;
					failure?: { signals: string[] };
					strategy?: string;
					pivotPlan?: string[];
					alternateRoutes?: string[];
					retryPolicy?: string[];
				}>;
			}
		).execute({
			action: "failureRecovery",
			command: "bun run typecheck",
			output: "error TS2307: Cannot find module './missing'",
		});
		expect(recovery.success).toBe(true);
		expect(recovery.failure?.signals).toContain("module-resolution");
		expect(recovery.strategy).toBe("pivot");
		expect(recovery.pivotPlan?.join("\n")).toContain("import path");
		expect(recovery.alternateRoutes?.join("\n")).toContain("Search for the exported symbol");
		expect(recovery.retryPolicy?.join("\n")).toContain("Do not retry deterministic");
	});

	it("chooses bounded retries or user escalation for recoverable failures", async () => {
		const transient = await (
			codingWorkbench as unknown as {
				execute: (input: unknown) => Promise<{
					success: boolean;
					strategy?: string;
					retryPolicy?: string[];
				}>;
			}
		).execute({
			action: "failureRecovery",
			command: "provider stream",
			output: "HTTP 503 temporary service unavailable",
		});
		expect(transient.success).toBe(true);
		expect(transient.strategy).toBe("retry");
		expect(transient.retryPolicy?.join("\n")).toContain("only once before pivoting");

		const blocked = await (
			codingWorkbench as unknown as {
				execute: (input: unknown) => Promise<{
					success: boolean;
					strategy?: string;
					reason?: string;
					pivotPlan?: string[];
				}>;
			}
		).execute({
			action: "failureRecovery",
			command: "gh pr checks",
			output: "403 forbidden: authenticate before retrying",
		});
		expect(blocked.success).toBe(true);
		expect(blocked.strategy).toBe("ask_user");
		expect(blocked.reason).toContain("approval, credentials, or permissions");
		expect(blocked.pivotPlan?.join("\n")).toContain("ask for the specific approval");
	});

	it("returns dashboard, context budget, and launch briefing status", async () => {
		await updateCodingTaskState({
			goal: "Improve ORPHEUS QoL",
			status: "in_progress",
			nextStep: "Run full validation",
		});
		await addExecutiveItem({
			kind: "risk",
			title: "Context window can overflow on long coding sessions",
		});

		const dashboard = await (
			daemonStatus as unknown as {
				execute: (input: unknown) => Promise<{
					success: boolean;
					dashboard?: { label: string; rows: unknown[]; fixActions: string[] };
				}>;
			}
		).execute({ scope: "dashboard" });
		expect(dashboard.success).toBe(true);
		expect(dashboard.dashboard?.label).toContain("HEALTH");
		expect(dashboard.dashboard?.rows.length).toBeGreaterThan(0);

		const budget = await (
			daemonStatus as unknown as {
				execute: (input: unknown) => Promise<{
					success: boolean;
					contextBudget?: { status: string; percentUsed?: number; recommendation: string };
				}>;
			}
		).execute({ scope: "contextBudget", promptTokens: 90, contextLength: 100 });
		expect(budget.success).toBe(true);
		expect(budget.contextBudget?.status).toBe("compact");

		const briefing = await (
			daemonStatus as unknown as {
				execute: (input: unknown) => Promise<{
					success: boolean;
					briefing?: { activeCodingTask?: { goal: string } | null; executive: { openCount: number } };
				}>;
			}
		).execute({ scope: "launchBriefing" });
		expect(briefing.success).toBe(true);
		expect(briefing.briefing?.activeCodingTask?.goal).toBe("Improve ORPHEUS QoL");
		expect(briefing.briefing?.executive.openCount).toBeGreaterThan(0);
	});

	it("verifies writeFile writes by reading the file back", async () => {
		const projectDir = await mkdtemp(path.join(os.tmpdir(), "orpheus-write-file-"));
		try {
			const target = path.join(projectDir, "notes", "receipt.txt");
			const result = await (
				writeFileTool as unknown as {
					execute: (input: unknown) => Promise<{
						success: boolean;
						path?: string;
						verified?: boolean;
						bytesWritten?: number;
					}>;
				}
			).execute({
				path: target,
				content: "verified write\n",
			});

			expect(result.success).toBe(true);
			expect(result.verified).toBe(true);
			expect(result.bytesWritten).toBe(Buffer.byteLength("verified write\n", "utf8"));
			expect(await readFile(target, "utf8")).toBe("verified write\n");
		} finally {
			await rm(projectDir, { recursive: true, force: true });
		}
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

	it("stacks durable ORPHEUS tasks across sessions", async () => {
		const pushed = await (
			executiveAssistant as unknown as {
				execute: (input: unknown) => Promise<{
					success: boolean;
					item?: { id: string; title: string; status: string; priority: string };
				}>;
			}
		).execute({
			action: "stackPush",
			title: "Wire Honcho status into ORPHEUS dashboard",
			priority: "high",
			nextStep: "Add status item and tests",
			source: "chat",
		});

		expect(pushed.success).toBe(true);
		expect(pushed.item?.status).toBe("queued");
		expect(pushed.item?.priority).toBe("high");

		const listed = await (
			executiveAssistant as unknown as {
				execute: (input: unknown) => Promise<{ success: boolean; items?: Array<{ title: string }> }>;
			}
		).execute({ action: "stackList" });
		expect(listed.items?.[0]?.title).toContain("Honcho status");

		const popped = await (
			executiveAssistant as unknown as {
				execute: (input: unknown) => Promise<{ success: boolean; item?: { status: string } }>;
			}
		).execute({ action: "stackPop" });
		expect(popped.success).toBe(true);
		expect(popped.item?.status).toBe("active");

		const state = await loadTaskStack();
		expect(state.items[0]?.title).toContain("Honcho status");
		expect(state.items[0]?.status).toBe("active");
	});
});
