#!/usr/bin/env bun

/**
 * ORPHEUS file watcher for instant test feedback.
 *
 * Watches src/ and __tests__/ for changes, then re-runs only the
 * tests that cover the modified files. Falls back to full test suite
 * if no matching tests found.
 *
 * Usage:
 *   bun run src/scripts/test-watcher.ts          # watch mode
 *   bun run src/scripts/test-watcher.ts --once   # single run then exit
 */

import { execSync, spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";

const SRC_DIR = "src";
const TEST_DIR = "__tests__";
const DEBOUNCE_MS = 500;

let pendingRun: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function log(message: string): void {
	console.log(message);
}

function findMatchingTests(changedFile: string): string[] {
	const tests: string[] = [];

	// Direct test file
	if (changedFile.includes(TEST_DIR)) {
		return [changedFile];
	}

	// Source file → look for corresponding test
	const base = path.basename(changedFile, ".ts");
	const _dir = path.dirname(changedFile);

	// Pattern 1: __tests__/path/to/file.test.ts
	const testPath1 = changedFile
		.replace(new RegExp(`^${SRC_DIR}/`), `${TEST_DIR}/`)
		.replace(/\.ts$/, ".test.ts");
	try {
		execSync(`test -f ${testPath1}`, { stdio: "pipe" });
		tests.push(testPath1);
	} catch {
		// Not found
	}

	// Pattern 2: __tests__/unit/file.test.ts (flat)
	const testPath2 = `${TEST_DIR}/${base}.test.ts`;
	try {
		execSync(`test -f ${testPath2}`, { stdio: "pipe" });
		tests.push(testPath2);
	} catch {
		// Not found
	}

	return tests;
}

function runTests(testFiles: string[]): void {
	if (isRunning) return;
	isRunning = true;

	const start = Date.now();
	const args = testFiles.length > 0 ? testFiles : [];
	const label = args.length > 0 ? args.map((f) => path.basename(f)).join(", ") : "full suite";

	log(`\n${CYAN}${BOLD}▶ Running ${label}${RESET}`);

	const child = spawn("bun", ["test", ...args], {
		stdio: "inherit",
		shell: false,
	});

	child.on("close", (code) => {
		isRunning = false;
		const duration = ((Date.now() - start) / 1000).toFixed(1);

		if (code === 0) {
			log(`${GREEN}${BOLD}✓ Passed${RESET} in ${duration}s\n`);
		} else {
			log(`${YELLOW}${BOLD}✗ Failed${RESET} (${code}) in ${duration}s\n`);
		}
	});
}

function handleChange(filePath: string): void {
	if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) return;

	if (pendingRun) {
		clearTimeout(pendingRun);
	}

	pendingRun = setTimeout(() => {
		const tests = findMatchingTests(filePath);
		if (tests.length > 0) {
			runTests(tests);
		} else {
			// No matching test found — run full suite to be safe
			log(`${YELLOW}No matching test for ${filePath} — running full suite${RESET}`);
			runTests([]);
		}
	}, DEBOUNCE_MS);
}

function main(): void {
	const once = process.argv.includes("--once");

	if (once) {
		log(`${BOLD}ORPHEUS Test Watcher${RESET} — single run\n`);
		runTests([]);
		return;
	}

	log(`${BOLD}ORPHEUS Test Watcher${RESET}`);
	log(`Watching ${SRC_DIR}/ and ${TEST_DIR}/ for changes...`);
	log(`${YELLOW}Press Ctrl+C to stop${RESET}\n`);

	// Watch source
	watch(SRC_DIR, { recursive: true }, (_event, filename) => {
		if (filename) handleChange(path.join(SRC_DIR, filename));
	});

	// Watch tests
	watch(TEST_DIR, { recursive: true }, (_event, filename) => {
		if (filename) handleChange(path.join(TEST_DIR, filename));
	});

	// Initial run
	runTests([]);
}

main();
