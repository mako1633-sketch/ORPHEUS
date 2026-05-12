import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";

const DEFAULT_MAX_FILES = 160;
const MAX_FILES = 400;
const SKIP_DIRS = new Set([
	".git",
	".next",
	".turbo",
	".venv",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"target",
	"vendor",
]);

const IMPORTANT_FILE_NAMES = new Set([
	"package.json",
	"bun.lock",
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"tsconfig.json",
	"vite.config.ts",
	"vite.config.js",
	"next.config.ts",
	"next.config.js",
	"biome.json",
	"eslint.config.js",
	"eslint.config.mjs",
	"README.md",
	"Cargo.toml",
	"go.mod",
	"pyproject.toml",
	"requirements.txt",
	"Makefile",
	"Dockerfile",
]);

type PackageJsonSummary = {
	name?: string;
	version?: string;
	scripts?: Record<string, string>;
	dependencies?: string[];
	devDependencies?: string[];
};

function safeRelative(root: string, filePath: string): string {
	return path.relative(root, filePath) || ".";
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function readPackageJson(root: string): Promise<PackageJsonSummary | null> {
	const packagePath = path.join(root, "package.json");
	if (!(await pathExists(packagePath))) return null;

	try {
		const parsed = JSON.parse(await fs.readFile(packagePath, "utf8")) as {
			name?: unknown;
			version?: unknown;
			scripts?: unknown;
			dependencies?: unknown;
			devDependencies?: unknown;
		};

		return {
			name: typeof parsed.name === "string" ? parsed.name : undefined,
			version: typeof parsed.version === "string" ? parsed.version : undefined,
			scripts:
				parsed.scripts && typeof parsed.scripts === "object"
					? (parsed.scripts as Record<string, string>)
					: undefined,
			dependencies:
				parsed.dependencies && typeof parsed.dependencies === "object"
					? Object.keys(parsed.dependencies as Record<string, unknown>).sort()
					: undefined,
			devDependencies:
				parsed.devDependencies && typeof parsed.devDependencies === "object"
					? Object.keys(parsed.devDependencies as Record<string, unknown>).sort()
					: undefined,
		};
	} catch {
		return null;
	}
}

async function collectProjectFiles(root: string, maxFiles: number): Promise<string[]> {
	const files: string[] = [];

	async function walk(dir: string): Promise<void> {
		if (files.length >= maxFiles) return;

		const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
		entries.sort((a, b) => {
			if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
			return a.name.localeCompare(b.name);
		});

		for (const entry of entries) {
			if (files.length >= maxFiles) break;
			if (entry.name.startsWith(".") && entry.name !== ".github") continue;
			if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;

			const fullPath = path.join(dir, entry.name);
			const rel = safeRelative(root, fullPath);

			if (entry.isDirectory()) {
				files.push(`${rel}/`);
				await walk(fullPath);
			} else if (entry.isFile()) {
				files.push(rel);
			}
		}
	}

	await walk(root);
	return files;
}

export function detectPackageManager(files: string[]): string | undefined {
	if (files.includes("bun.lock")) return "bun";
	if (files.includes("pnpm-lock.yaml")) return "pnpm";
	if (files.includes("yarn.lock")) return "yarn";
	if (files.includes("package-lock.json")) return "npm";
	return undefined;
}

function getGitStatus(root: string): string[] | undefined {
	try {
		const output = execFileSync("git", ["status", "--short", "--branch"], {
			cwd: root,
			encoding: "utf8",
			timeout: 3000,
			stdio: ["ignore", "pipe", "ignore"],
		});
		return output
			.split(/\r?\n/)
			.map((line) => line.trimEnd())
			.filter(Boolean);
	} catch {
		return undefined;
	}
}

export async function summarizeProjectContext({
	root,
	maxFiles = DEFAULT_MAX_FILES,
}: {
	root?: string;
	maxFiles?: number;
}) {
	const projectRoot = path.resolve(root ?? process.cwd());
	const safeMaxFiles = Math.min(Math.max(maxFiles, 20), MAX_FILES);

	try {
		const files = await collectProjectFiles(projectRoot, safeMaxFiles);
		const packageJson = await readPackageJson(projectRoot);
		const importantFiles = files.filter((file) => IMPORTANT_FILE_NAMES.has(path.basename(file)));

		return {
			success: true,
			root: projectRoot,
			packageManager: detectPackageManager(files),
			package: packageJson,
			importantFiles,
			gitStatus: getGitStatus(projectRoot),
			fileCountReturned: files.length,
			truncated: files.length >= safeMaxFiles,
			files,
		};
	} catch (error: unknown) {
		const err = error instanceof Error ? error : new Error(String(error));
		return {
			success: false,
			root: projectRoot,
			error: err.message,
		};
	}
}

export const projectContext = tool({
	description:
		"Summarize a local software project before coding work. Returns package scripts, dependency names, important config files, git status, and a shallow file tree while skipping heavy directories.",
	inputSchema: z.object({
		root: z
			.string()
			.optional()
			.describe("Project root to inspect. Defaults to the current working directory."),
		maxFiles: z
			.number()
			.int()
			.min(20)
			.max(MAX_FILES)
			.optional()
			.default(DEFAULT_MAX_FILES)
			.describe(`Maximum number of file/tree entries to return, max ${MAX_FILES}.`),
	}),
	execute: summarizeProjectContext,
});
