#!/usr/bin/env bun
/**
 * ORPHEUS diff-review script.
 * Runs on staged changes before commit to catch issues that shouldn't ship:
 * - console.log left behind
 * - TODOs without issue references
 * - New files without test coverage
 * - Biome ignore comments
 * - Large file additions
 */

import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

interface DiffReviewFinding {
	severity: "warn" | "error";
	file: string;
	line?: number;
	message: string;
	category: string;
}

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function log(message: string): void {
	console.log(message);
}

function getStagedDiff(): string {
	try {
		return execSync("git diff --cached --no-color", { encoding: "utf-8" });
	} catch {
		return "";
	}
}

function getStagedFiles(): string[] {
	try {
		const output = execSync("git diff --cached --name-only --diff-filter=ACM", {
			encoding: "utf-8",
		});
		return output.split("\n").filter((f) => f.trim().length > 0);
	} catch {
		return [];
	}
}

function getNewFiles(): string[] {
	try {
		const output = execSync("git diff --cached --name-only --diff-filter=A", { encoding: "utf-8" });
		return output.split("\n").filter((f) => f.trim().length > 0);
	} catch {
		return [];
	}
}

function analyzeDiff(diff: string): DiffReviewFinding[] {
	const findings: DiffReviewFinding[] = [];
	const lines = diff.split("\n");
	let currentFile = "";
	let lineNumber = 0;

	for (const line of lines) {
		if (line.startsWith("+++")) {
			currentFile = line.slice(6).trim();
			lineNumber = 0;
			continue;
		}
		if (line.startsWith("@@")) {
			const match = /\+([0-9]+)/.exec(line);
			lineNumber = match ? Number.parseInt(match[1]!, 10) : 0;
			continue;
		}
		if (line.startsWith("+")) {
			lineNumber += 1;
			const added = line.slice(1);

			// console.log detection
			const consoleMatch = added.match(/console\.\s*(log|warn|error|debug)\s*\(/);
			if (consoleMatch && !added.includes("debug-logger")) {
				findings.push({
					severity: "warn",
					file: currentFile,
					line: lineNumber,
					message: `console.log statement: ${added.trim().slice(0, 60)}`,
					category: "debug-artifact",
				});
			}

			// TODO without issue reference
			if (added.includes("TODO") && !/TODO\s*\(#\d+\)/.test(added)) {
				findings.push({
					severity: "warn",
					file: currentFile,
					line: lineNumber,
					message: `TODO without issue reference: ${added.trim().slice(0, 60)}`,
					category: "todo-missing-ref",
				});
			}

			// Biome ignore comments
			if (added.includes("biome-ignore")) {
				findings.push({
					severity: "error",
					file: currentFile,
					line: lineNumber,
					message: `Biome ignore comment added — should not ship: ${added.trim().slice(0, 60)}`,
					category: "lint-suppression",
				});
			}

			// debugger statement
			if (/^\s*debugger;?\s*$/.test(added)) {
				findings.push({
					severity: "error",
					file: currentFile,
					line: lineNumber,
					message: "debugger statement should not ship",
					category: "debug-artifact",
				});
			}
		}
	}

	return findings;
}

async function checkNewFileTests(newFiles: string[]): Promise<DiffReviewFinding[]> {
	const findings: DiffReviewFinding[] = [];
	for (const file of newFiles) {
		if (!file.endsWith(".ts") || file.includes("__tests__")) continue;

		// Check if there's a corresponding test file
		const testPaths = [
			file.replace("src/", "__tests__/").replace(".ts", ".test.ts"),
			file.replace(".ts", ".test.ts"),
		];

		let hasTest = false;
		for (const testPath of testPaths) {
			try {
				await fs.access(testPath);
				hasTest = true;
				break;
			} catch {
				// Not found
			}
		}

		if (!hasTest) {
			findings.push({
				severity: "warn",
				file,
				message: "New file added without corresponding test coverage",
				category: "missing-test",
			});
		}
	}
	return findings;
}

async function checkLargeFiles(files: string[]): Promise<DiffReviewFinding[]> {
	const findings: DiffReviewFinding[] = [];
	for (const file of files) {
		try {
			const stat = await fs.stat(file);
			const sizeKb = stat.size / 1024;
			if (sizeKb > 500) {
				findings.push({
					severity: "warn",
					file,
					message: `Large file (${Math.round(sizeKb)}KB) — consider if this should be in repo`,
					category: "large-file",
				});
			}
		} catch {
			// Skip files we can't stat
		}
	}
	return findings;
}

async function main(): Promise<void> {
	log(`\n${BOLD}ORPHEUS Diff Review${RESET} — checking staged changes...\n`);

	const diff = getStagedDiff();
	const stagedFiles = getStagedFiles();
	const newFiles = getNewFiles();

	if (stagedFiles.length === 0) {
		log(`${YELLOW}No staged files to review.${RESET}\n`);
		process.exit(0);
	}

	log(`${stagedFiles.length} file(s) staged, ${newFiles.length} new\n`);

	const findings: DiffReviewFinding[] = [
		...analyzeDiff(diff),
		...(await checkNewFileTests(newFiles)),
		...(await checkLargeFiles(stagedFiles)),
	];

	if (findings.length === 0) {
		log(`${GREEN}${BOLD}\u2705 No issues found \u2014 ready to commit.${RESET}\n`);
		process.exit(0);
	}

	const errors = findings.filter((f) => f.severity === "error");
	const warns = findings.filter((f) => f.severity === "warn");

	log(`${BOLD}Findings:${RESET}`);
	for (const finding of findings) {
		const icon = finding.severity === "error" ? `${RED}\u2717` : `${YELLOW}\u26A0`;
		const lineInfo = finding.line ? `:${finding.line}` : "";
		log(`  ${icon}${RESET} [${finding.category}] ${finding.file}${lineInfo}`);
		log(`     \u2192 ${finding.message}`);
	}
	log("");

	log(
		`${BOLD}\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550${RESET}`
	);
	if (errors.length > 0) {
		log(`${RED}${BOLD}  ${errors.length} ERROR(S) \u2014 commit blocked.${RESET}`);
		log(`${YELLOW}  Fix errors above before committing.${RESET}\n`);
		process.exit(1);
	}

	log(`${YELLOW}${BOLD}  ${warns.length} WARNING(S)${RESET} \u2014 commit allowed with warnings.`);
	log(`${YELLOW}  Review warnings above; some may need attention.${RESET}\n`);
	process.exit(0);
}

main();
