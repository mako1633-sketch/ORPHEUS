#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const args = process.argv.slice(2);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (args.includes("--version") || args.includes("-v")) {
	const packageJson = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
		version?: string;
	};
	console.log(packageJson.version ?? "unknown");
	process.exit(0);
}

const bunCandidates =
	process.platform === "win32"
		? ["bun.exe"]
		: [
				process.env.BUN_INSTALL ? path.join(process.env.BUN_INSTALL, "bin", "bun") : undefined,
				path.join(os.homedir(), ".bun", "bin", "bun"),
				"bun",
			].filter((candidate): candidate is string => Boolean(candidate));

let bunCmd = bunCandidates[0] ?? "bun";
let bunCheck = spawnSync(bunCmd, ["--version"], { stdio: "ignore" });

for (const candidate of bunCandidates.slice(1)) {
	if (!bunCheck.error && bunCheck.status === 0) break;
	bunCmd = candidate;
	bunCheck = spawnSync(bunCmd, ["--version"], { stdio: "ignore" });
}

if (bunCheck.error || bunCheck.status !== 0) {
	const installHint =
		process.platform === "darwin"
			? "Install it with: curl -fsSL https://bun.sh/install | bash"
			: "Install it from https://bun.sh and try again.";
	console.error(`ORPHEUS requires Bun. ${installHint}`);
	process.exit(1);
}

const entry = path.join(packageRoot, "src", "index.tsx");
const result = spawnSync(bunCmd, [entry, ...args], { stdio: "inherit" });

if (result.error) {
	const error = result.error instanceof Error ? result.error : new Error(String(result.error));
	console.error(error.message);
	process.exit(1);
}

process.exit(result.status ?? 0);
