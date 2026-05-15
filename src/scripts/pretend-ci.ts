#!/usr/bin/env bun
/**
 * ORPHEUS pre-push validation gate.
 * Runs the exact same checks the Ubuntu CI runner runs, but locally.
 * Exit code 0 = all clear, exit code 1 = push blocked.
 */

import { execSync } from "node:child_process";
import { debug } from "../utils/debug-logger";

const CI_STEPS = [
	{
		name: "Install dependencies",
		command: "bun install",
		skippable: true, // already installed locally most of the time
	},
	{
		name: "TypeScript typecheck",
		command: "bun x tsc -p tsconfig.json --noEmit",
	},
	{
		name: "Linter",
		command: "biome lint src __tests__",
	},
	{
		name: "Format check",
		command: "biome format src __tests__",
	},
	{
		name: "Tests",
		command: "bun test",
	},
];

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function log(message: string): void {
	console.log(message);
}

function runStep(step: (typeof CI_STEPS)[number], index: number): boolean {
	log(`${BOLD}[${index + 1}/${CI_STEPS.length}]${RESET} ${step.name}...`);

	if (step.skippable) {
		try {
			execSync("bun pm ls 2>/dev/null | head -1", { stdio: "pipe" });
			log(`${GREEN}  ✓${RESET} Dependencies appear up to date (skipping install)\n`);
			return true;
		} catch {
			// Fall through to install
		}
	}

	try {
		execSync(step.command, { stdio: "inherit" });
		log(`${GREEN}  ✓${RESET} ${step.name} passed\n`);
		return true;
	} catch (error) {
		log(`${RED}  ✗${RESET} ${step.name} ${RED}FAILED${RESET}`);
		if (error instanceof Error) {
			log(`${RED}  → ${error.message}${RESET}`);
		}
		log("");
		return false;
	}
}

async function main(): Promise<void> {
	log(`\n${BOLD}ORPHEUS Pre-Push Gate${RESET} — running CI checks locally...\n`);

	const results: boolean[] = [];
	for (let i = 0; i < CI_STEPS.length; i += 1) {
		results.push(runStep(CI_STEPS[i]!, i));
	}

	const passed = results.filter(Boolean).length;
	const total = results.length;

	log(`${BOLD}═══════════════════════════════════════════════${RESET}`);
	if (passed === total) {
		log(`${GREEN}${BOLD}  ALL CHECKS PASSED${RESET}  ${GREEN}(${passed}/${total})${RESET}`);
		log(`${BOLD}  Ready to push.${RESET}\n`);
		process.exit(0);
	}

	log(`${RED}${BOLD}  ${total - passed} CHECK(S) FAILED${RESET}`);
	log(`${YELLOW}  Fix issues above before pushing.${RESET}`);
	log(`${YELLOW}  Quick fixes:${RESET}`);
	log(`${YELLOW}    bun run format${RESET}  → fix formatting`);
	log(`${YELLOW}    bun run lint:fix${RESET} → fix lint issues`);
	log("");

	debug.error("pretend-ci-failed", { passed, total, steps: CI_STEPS.length });
	process.exit(1);
}

main();
