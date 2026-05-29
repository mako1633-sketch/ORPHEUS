import { access } from "node:fs/promises";
import { callFindEvilTool, createFindEvilContext, resolveFindEvilConfig } from "./core";
import type { FindEvilToolResult } from "./types";

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

async function validate(args: string[]) {
	const parsed = parseArgs(args);
	const config = resolveFindEvilConfig({
		imagePath: typeof parsed.image === "string" ? parsed.image : undefined,
		caseId: typeof parsed["case-id"] === "string" ? parsed["case-id"] : undefined,
		outputDir: typeof parsed["output-dir"] === "string" ? parsed["output-dir"] : undefined,
		allowWritableImage: parsed.allowWritableImage === true,
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
	const ctx = await createFindEvilContext({
		imagePath: typeof parsed.image === "string" ? parsed.image : undefined,
		caseId: typeof parsed["case-id"] === "string" ? parsed["case-id"] : undefined,
		outputDir: typeof parsed["output-dir"] === "string" ? parsed["output-dir"] : undefined,
		allowWritableImage: parsed.allowWritableImage === true,
	});
	const offset = typeof parsed.offset === "string" ? Number(parsed.offset) : undefined;
	const indicators =
		typeof parsed.indicators === "string"
			? parsed.indicators
					.split(",")
					.map((item) => item.trim())
					.filter(Boolean)
			: ["powershell", "rundll32", "schtasks", "temp"];

	printResult(await callFindEvilTool(ctx, "hash_evidence", {}));
	printResult(await callFindEvilTool(ctx, "inspect_partitions", {}));
	printResult(await callFindEvilTool(ctx, "list_files", { offset }));
	printResult(await callFindEvilTool(ctx, "build_timeline", { offset }));
	printResult(await callFindEvilTool(ctx, "search_indicators", { indicators }));
	printResult(
		await callFindEvilTool(ctx, "summarize_findings", {
			notes:
				"Demo run: if partition-sensitive tools fail, rerun with --offset from inspect_partitions. That rerun is the self-correction sequence to show in the video.",
		})
	);
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
		console.log("  bun run src/find-evil/cli.ts demo -- --image /abs/case.dd --case-id case-001");
		process.exit(command ? 1 : 0);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

if (import.meta.main) {
	await main();
}
