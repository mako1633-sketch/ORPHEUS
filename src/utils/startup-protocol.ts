/**
 * ORPHEUS startup protocol enforcement.
 * Runs the orpheus-startup bash script and returns structured results.
 */

import { spawn } from "child_process";
import { debug } from "./debug-logger";

export type StartupStatus = "ok" | "warnings" | "critical" | "not-run";

export interface StartupResult {
	status: StartupStatus;
	exitCode: number;
	stdout: string;
	stderr: string;
	durationMs: number;
	lastRunAt: number;
}

const STARTUP_SCRIPT = `${process.env.HOME}/.config/orpheus/workspaces/4225ca70-bc89-46be-99ef-d3e82098faf2/bin/orpheus-startup`;
const FALLBACK_SCRIPT = `${process.env.HOME}/.config/orpheus/bin/orpheus-startup`;
const REPO_SCRIPT = `${process.cwd()}/bin/orpheus-startup`;

let lastResult: StartupResult | null = null;

function findStartupScript(): string | null {
	const fs = require("node:fs");
	const candidates = [STARTUP_SCRIPT, FALLBACK_SCRIPT, REPO_SCRIPT];
	for (const candidate of candidates) {
		try {
			if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
				return candidate;
			}
		} catch {
			/* ignore */
		}
	}
	return null;
}

export async function runStartupProtocol(): Promise<StartupResult> {
	const scriptPath = findStartupScript();
	if (!scriptPath) {
		const result: StartupResult = {
			status: "critical",
			exitCode: 1,
			stdout: "",
			stderr: "Startup script not found. Expected at: " + STARTUP_SCRIPT,
			durationMs: 0,
			lastRunAt: Date.now(),
		};
		lastResult = result;
		return result;
	}

	const t0 = performance.now();
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";

		const child = spawn("bash", [scriptPath], {
			env: { ...process.env, ORPHEUS_STARTUP_QUIET: "1" },
		});

		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf-8");
		});

		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf-8");
		});

		child.on("close", (code) => {
			const exitCode = code ?? 1;
			const durationMs = Math.round(performance.now() - t0);

			let status: StartupStatus;
			if (exitCode === 0) status = "ok";
			else if (exitCode === 2) status = "warnings";
			else status = "critical";

			// Heuristic: if stderr contains "BLOCKER" or "CRITICAL", override to critical
			if (stderr.includes("BLOCKER") || stderr.includes("CRITICAL")) {
				status = "critical";
			}

			const result: StartupResult = {
				status,
				exitCode,
				stdout,
				stderr,
				durationMs,
				lastRunAt: Date.now(),
			};
			lastResult = result;
			debug.log("startup-protocol", result);
			resolve(result);
		});

		child.on("error", (err) => {
			const durationMs = Math.round(performance.now() - t0);
			const result: StartupResult = {
				status: "critical",
				exitCode: 1,
				stdout: "",
				stderr: `Failed to spawn startup script: ${err.message}`,
				durationMs,
				lastRunAt: Date.now(),
			};
			lastResult = result;
			debug.error("startup-protocol-spawn", { message: err.message });
			resolve(result);
		});
	});
}

export function getLastStartupResult(): StartupResult | null {
	return lastResult;
}

export function hasStartupRun(): boolean {
	return lastResult !== null && lastResult.status !== "not-run";
}

export function isSessionReady(): boolean {
	if (!lastResult) return false;
	return lastResult.status === "ok" || lastResult.status === "warnings";
}
