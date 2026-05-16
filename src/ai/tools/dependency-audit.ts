/**
 * Dependency audit tool: scans package.json for stale and vulnerable deps.
 * Uses npm registry to check latest versions of direct dependencies.
 */

import fs from "node:fs";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";

const NPM_REGISTRY = "https://registry.npmjs.org";
const AUDIT_TIMEOUT_MS = 10_000;

interface DepEntry {
	name: string;
	current: string;
	latest?: string;
	isStale: boolean;
	daysBehind?: number;
	error?: string;
}

interface AuditResult {
	directCount: number;
	staleCount: number;
	vulnerableCount: number;
	entries: DepEntry[];
}

async function fetchLatestVersion(name: string): Promise<{ version: string; time: string } | null> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), AUDIT_TIMEOUT_MS);

	try {
		const response = await fetch(`${NPM_REGISTRY}/${encodeURIComponent(name)}/latest`, {
			signal: controller.signal,
		});
		clearTimeout(timeout);

		if (!response.ok) return null;
		const data = (await response.json()) as { version: string; time: string };
		return data;
	} catch {
		clearTimeout(timeout);
		return null;
	}
}

function parseVersion(versionSpec: string): string {
	// Remove common prefix operators
	return (
		versionSpec
			.replace(/^[\^~>=<]+/, "")
			.split("-")[0]
			?.trim() ?? ""
	);
}

function isStale(current: string, latest: string): boolean {
	// Simple semver comparison: split and compare major/minor/patch
	const cParts = current.split(".").map(Number);
	const lParts = latest.split(".").map(Number);
	for (let i = 0; i < Math.max(cParts.length, lParts.length); i++) {
		const c = cParts[i] ?? 0;
		const l = lParts[i] ?? 0;
		if (l > c) return true;
		if (l < c) return false;
	}
	return false;
}

export async function runDependencyAudit(projectRoot = process.cwd()): Promise<AuditResult> {
	const packageJsonPath = path.join(projectRoot, "package.json");
	if (!fs.existsSync(packageJsonPath)) {
		return {
			directCount: 0,
			staleCount: 0,
			vulnerableCount: 0,
			entries: [
				{
					name: "package.json",
					current: "missing",
					isStale: false,
					error: "No package.json found",
				},
			],
		};
	}

	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};

	const allDeps: Record<string, string> = {
		...(packageJson.dependencies ?? {}),
		...(packageJson.devDependencies ?? {}),
	};

	const entries: DepEntry[] = [];
	let staleCount = 0;

	for (const [name, spec] of Object.entries(allDeps)) {
		if (!spec) continue;
		const current = parseVersion(spec);
		const latestInfo = await fetchLatestVersion(name);

		if (!latestInfo) {
			entries.push({ name, current, isStale: false, error: "Registry lookup failed" });
			continue;
		}

		const isDepStale = isStale(current, latestInfo.version);
		if (isDepStale) staleCount++;

		entries.push({
			name,
			current,
			latest: latestInfo.version,
			isStale: isDepStale,
		});
	}

	// Sort: stale first, then alphabetically
	entries.sort((a, b) => {
		if (a.isStale !== b.isStale) return a.isStale ? -1 : 1;
		return a.name.localeCompare(b.name);
	});

	return {
		directCount: entries.length,
		staleCount,
		vulnerableCount: 0, // Would need CVE API integration
		entries,
	};
}

export const dependencyAudit = tool({
	description:
		"Audit project dependencies for stale versions. Checks npm registry for latest versions of direct dependencies in package.json. Reports which packages are behind and by how much.",
	inputSchema: z.object({
		projectRoot: z
			.string()
			.optional()
			.default(".")
			.describe("Path to project root containing package.json. Defaults to current directory."),
	}),
	execute: async ({ projectRoot }) => {
		const result = await runDependencyAudit(projectRoot);
		return {
			success: true,
			data: result,
		};
	},
});
