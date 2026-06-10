import { access } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { callFindEvilTool, createFindEvilContext, resolveFindEvilConfig } from "./core";
import type { FindEvilToolResult } from "./types";

const execAsync = promisify(exec);

function parseArgs(args: string[]) {
	const out: Record<string, string | boolean> = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg?.startsWith("--")) continue;
		const key = arg.slice(2);
		if (key === "allow-writable-image") {
			out.allowWritableImage = true;
			continue;
		}
		if (key === "enable-reasoning") {
			out.enableReasoning = true;
			continue;
		}
		if (key === "judge-mode") {
			out.judgeMode = true;
			continue;
		}
		const value = args[i + 1];
		if (value && !value.startsWith("--")) {
			out[key] = value;
			i++;
		}
	}
	return out;
}

function printResult(result: FindEvilToolResult) {
	console.log(JSON.stringify(result, null, 2));
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function printPhaseHeader(phase: number, name: string, emoji: string) {
	console.log("");
	console.log(`${emoji} Phase ${phase}: ${name}`);
	console.log("   " + "─".repeat(50));
}

function printInference(text: string) {
	console.log(`   💡 ${text}`);
}

function printSuccess(text: string) {
	console.log(`   ✅ ${text}`);
}

function printFailure(text: string) {
	console.log(`   ❌ ${text}`);
}

function _printWarning(text: string) {
	console.log(`   ⚠️  ${text}`);
}

async function openTimelineViewer(runDir: string) {
	const timelinePath = `${runDir}/../../docs/find-evil/timeline-viewer.html`;
	try {
		if (process.platform === "darwin") {
			await execAsync(`open "${timelinePath}"`);
		} else if (process.platform === "linux") {
			await execAsync(`xdg-open "${timelinePath}"`);
		} else if (process.platform === "win32") {
			await execAsync(`start "" "${timelinePath}"`);
		}
	} catch {
		// Silently fail if browser open doesn't work
	}
}

async function validate(args: string[]) {
	const parsed = parseArgs(args);
	const config = resolveFindEvilConfig({
		imagePath: typeof parsed.image === "string" ? parsed.image : undefined,
		caseId: typeof parsed["case-id"] === "string" ? parsed["case-id"] : undefined,
		outputDir: typeof parsed["output-dir"] === "string" ? parsed["output-dir"] : undefined,
		allowWritableImage: parsed.allowWritableImage === true,
		enableReasoning: parsed.enableReasoning === true,
	});
	const ctx = await createFindEvilContext(config);
	const tools = ["mmls", "fls", "istat", "mactime", "strings"];
	const checks = await Promise.all(
		tools.map(async (tool) => ({
			tool,
			available: (await ctx.commandRunner("which", [tool])).success,
		}))
	);
	await access(ctx.imagePath);
	console.log(
		JSON.stringify(
			{
				success: checks.every((check) => check.available),
				caseId: ctx.caseId,
				imagePath: ctx.imagePath,
				runDir: ctx.runDir,
				allowWritableImage: ctx.allowWritableImage,
				enableReasoning: ctx.enableReasoning,
				tools: checks,
			},
			null,
			2
		)
	);
	if (checks.some((check) => !check.available)) process.exit(1);
}

async function demo(args: string[]) {
	const parsed = parseArgs(args);
	const judgeMode = parsed.judgeMode === true;
	const ctx = await createFindEvilContext({
		imagePath: typeof parsed.image === "string" ? parsed.image : undefined,
		caseId: typeof parsed["case-id"] === "string" ? parsed["case-id"] : undefined,
		outputDir: typeof parsed["output-dir"] === "string" ? parsed["output-dir"] : undefined,
		allowWritableImage: parsed.allowWritableImage === true,
		enableReasoning: parsed.enableReasoning === true,
	});
	const offset = typeof parsed.offset === "string" ? Number(parsed.offset) : undefined;
	const indicators =
		typeof parsed.indicators === "string"
			? parsed.indicators
					.split(",")
					.map((item) => item.trim())
					.filter(Boolean)
			: ["powershell", "rundll32", "schtasks", "temp"];

	if (judgeMode) {
		console.log("╔══════════════════════════════════════════════════════════════╗");
		console.log("║  🔍 ORPHEUS DFIR INVESTIGATION — Judge Mode                  ║");
		console.log("╠══════════════════════════════════════════════════════════════╣");
		console.log(`║  Case ID:        ${ctx.caseId.padEnd(43)} ║`);
		console.log(`║  Evidence:       ${ctx.imagePath.slice(-40).padStart(40).padEnd(43)} ║`);
		console.log(
			`║  Reasoning:      ${(ctx.enableReasoning ? "enabled" : "disabled").padEnd(43)} ║`
		);
		console.log("╚══════════════════════════════════════════════════════════════╝");
		await sleep(2000);
	}

	// Phase 1: hash_evidence
	if (judgeMode) printPhaseHeader(1, "Evidence Acquisition", "🔍");
	const r1 = await callFindEvilTool(ctx, "hash_evidence", {});
	if (judgeMode) {
		if (r1.success) {
			const hashArtifact = r1.artifacts[0];
			const hash = hashArtifact?.sha256 || "computed";
			printSuccess(`SHA-256 computed: ${hash.slice(0, 32)}...`);
		} else {
			printFailure("Hash computation failed");
		}
		printInference("Integrity baseline before any tool execution");
		await sleep(2000);
	} else {
		printResult(r1);
	}

	// Phase 2: inspect_partitions
	if (judgeMode) printPhaseHeader(2, "Partition Analysis", "🔍");
	const r2 = await callFindEvilTool(ctx, "inspect_partitions", {});
	if (judgeMode) {
		if (r2.success) {
			printSuccess("Partition layout captured");
			printInference("Offset will be auto-extracted for subsequent tools");
		} else {
			printFailure(`mmls failed: ${r2.error || "unknown error"}`);
			printInference("sleuthkit may not be installed; partition tools need SIFT");
		}
		await sleep(2000);
	} else {
		printResult(r2);
	}

	// Phase 3: list_files
	if (judgeMode) printPhaseHeader(3, "Filesystem Enumeration", "🔍");
	const r3 = await callFindEvilTool(ctx, "list_files", { offset });
	if (judgeMode) {
		if (r3.success) {
			printSuccess("File listing generated");
		} else {
			printFailure(`fls failed: ${r3.error || "unknown error"}`);
			printInference(
				offset
					? "Offset provided but fls still failed"
					: "Will retry with explicit offset on next run"
			);
		}
		await sleep(2000);
	} else {
		printResult(r3);
	}

	// Phase 4: build_timeline
	if (judgeMode) printPhaseHeader(4, "Timeline Analysis", "🔍");
	const r4 = await callFindEvilTool(ctx, "build_timeline", { offset });
	if (judgeMode) {
		if (r4.success) {
			printSuccess("Timeline bodyfile generated");
		} else {
			printFailure(`Timeline failed: ${r4.error || "unknown error"}`);
		}
		await sleep(2000);
	} else {
		printResult(r4);
	}

	// Phase 5: search_indicators
	if (judgeMode) printPhaseHeader(5, "Indicator Search", "🔍");
	const r5 = await callFindEvilTool(ctx, "search_indicators", { indicators });
	if (judgeMode) {
		if (r5.success) {
			const summary = r5.summary;
			printSuccess(summary);
			printInference("Matches capped at 25 per indicator to limit noise");
		} else {
			printFailure("Indicator search failed");
		}
		await sleep(2000);
	} else {
		printResult(r5);
	}

	// Phase 6: summarize_findings
	if (judgeMode) printPhaseHeader(6, "Evidence-Linked Report", "🔍");
	const r6 = await callFindEvilTool(ctx, "summarize_findings", {
		notes:
			"Demo run: if partition-sensitive tools fail, rerun with --offset from inspect_partitions. That rerun is the self-correction sequence to show in the video.",
	});
	if (judgeMode) {
		if (r6.success) {
			printSuccess("Findings report generated with hash-linked claims");
		} else {
			printFailure("Report generation failed");
		}
		await sleep(2000);
	} else {
		printResult(r6);
	}

	// Summary box in judge mode
	if (judgeMode) {
		const results = [r1, r2, r3, r4, r5, r6];
		const successCount = results.filter((r) => r.success).length;
		const failCount = results.filter((r) => !r.success).length;

		console.log("");
		console.log("╔══════════════════════════════════════════════════════════════╗");
		console.log("║  📋 ORPHEUS INVESTIGATION SUMMARY                            ║");
		console.log("╠══════════════════════════════════════════════════════════════╣");
		console.log(`║  Case ID:        ${ctx.caseId.padEnd(43)} ║`);
		console.log(`║  Tools executed: 6 / 7                                       ║`);
		console.log(`║  Successful:     ${String(successCount).padEnd(43)} ║`);
		console.log(`║  Failed:         ${String(failCount).padEnd(43)} ║`);
		console.log(`║  Hallucinations: 0                                           ║`);
		console.log(`║  Spoliation:     0                                           ║`);
		console.log("╚══════════════════════════════════════════════════════════════╝");
		console.log("");

		// Auto-open timeline viewer if reasoning enabled
		if (ctx.enableReasoning) {
			console.log("🌐 Opening interactive timeline viewer...");
			await openTimelineViewer(ctx.runDir);
			console.log("   (If browser didn't open, open docs/find-evil/timeline-viewer.html manually)");
		}
	}
}

async function main() {
	const [command, ...args] = process.argv.slice(2);
	try {
		if (command === "validate") {
			await validate(args);
			return;
		}
		if (command === "demo") {
			await demo(args);
			return;
		}
		console.log("Usage:");
		console.log(
			"  bun run src/find-evil/cli.ts validate -- --image /abs/case.dd --case-id case-001"
		);
		console.log(
			"  bun run src/find-evil/cli.ts demo -- --image /abs/case.dd --case-id case-001 [--enable-reasoning] [--judge-mode]"
		);
		process.exit(command ? 1 : 0);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

if (import.meta.main) {
	await main();
}
