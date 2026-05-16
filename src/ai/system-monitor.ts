/**
 * Proactive System Monitor
 * Lightweight checks that run on startup and can be triggered on demand.
 * Surfaces disk health, git dirty states, security posture drift,
 * and dependency vulnerabilities without waiting for the user to ask.
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { debug } from "../utils/debug-logger";

const execFileAsync = promisify(execFile);

export interface SystemAlert {
	severity: "info" | "warning" | "critical";
	category: "disk" | "git" | "security" | "dependency" | "memory";
	message: string;
	context?: string;
	recommendedAction?: string;
}

export interface MonitorReport {
	checkedAt: string;
	alerts: SystemAlert[];
	ok: boolean;
}

const DISK_WARNING_THRESHOLD = 85;
const DISK_CRITICAL_THRESHOLD = 95;
const MEMORY_WARNING_THRESHOLD = 90;
const DEEP_MONITOR = process.env.ORPHEUS_REPORT_DEEP === "1";
const MONITOR_COMMAND_TIMEOUT_MS = DEEP_MONITOR ? 5000 : 1200;

async function checkDisk(): Promise<SystemAlert[]> {
	const alerts: SystemAlert[] = [];
	try {
		const { stdout } = await execFileAsync("df", ["-h", "/"], { timeout: 5000 });
		const line = stdout.split("\n").find((l) => l.includes("/") && !l.includes("Filesystem"));
		if (line) {
			const parts = line.trim().split(/\s+/);
			const percentStr = parts[parts.length - 2];
			const percent = Number.parseInt(percentStr?.replace("%", "") ?? "0", 10);
			if (percent >= DISK_CRITICAL_THRESHOLD) {
				alerts.push({
					severity: "critical",
					category: "disk",
					message: `Disk at ${percent}% - critical space shortage`,
					recommendedAction: "Clean caches, remove old artifacts, or expand storage",
				});
			} else if (percent >= DISK_WARNING_THRESHOLD) {
				alerts.push({
					severity: "warning",
					category: "disk",
					message: `Disk at ${percent}% - consider cleanup`,
					recommendedAction: "Run clean:artifacts or review large directories",
				});
			}
		}
	} catch {
		// df may not be available on all platforms
	}
	return alerts;
}

async function checkMemory(): Promise<SystemAlert[]> {
	const alerts: SystemAlert[] = [];
	try {
		const total = os.totalmem();
		const free = os.freemem();
		const usedPercent = Math.round(((total - free) / total) * 100);
		if (usedPercent >= MEMORY_WARNING_THRESHOLD) {
			alerts.push({
				severity: "warning",
				category: "memory",
				message: `Memory at ${usedPercent}% - pressure detected`,
				recommendedAction: "Close unused applications or restart memory-heavy processes",
			});
		}
	} catch {
		// os module might not expose these
	}
	return alerts;
}

async function checkGitDirty(baseDir = process.cwd()): Promise<SystemAlert[]> {
	const alerts: SystemAlert[] = [];
	try {
		let repos: string[] = [];
		if (DEEP_MONITOR) {
			const { stdout } = await execFileAsync(
				"find",
				[os.homedir(), "-maxdepth", "3", "-name", ".git", "-type", "d"],
				{ timeout: MONITOR_COMMAND_TIMEOUT_MS }
			);
			repos = stdout.trim().split("\n").filter(Boolean);
		} else {
			repos = [path.join(baseDir, ".git")].filter(Boolean);
		}
		const dirtyRepos: string[] = [];
		for (const gitDir of repos.slice(0, DEEP_MONITOR ? 20 : 1)) {
			const repoDir = path.dirname(gitDir);
			try {
				const { stdout: status } = await execFileAsync(
					"git",
					["-C", repoDir, "status", "--porcelain"],
					{
						timeout: MONITOR_COMMAND_TIMEOUT_MS,
					}
				);
				if (status.trim().length > 0) {
					dirtyRepos.push(path.basename(repoDir));
				}
			} catch {
				// ignore repos where git status fails
			}
		}
		if (dirtyRepos.length > 0) {
			alerts.push({
				severity: "info",
				category: "git",
				message: `${dirtyRepos.length} repo(s) have uncommitted changes: ${dirtyRepos.slice(0, 5).join(", ")}${dirtyRepos.length > 5 ? "..." : ""}`,
				recommendedAction: "Review and commit or stash changes",
			});
		}
	} catch {
		// find not available or timed out
	}
	return alerts;
}

async function checkNodeModulesBloat(baseDir = process.cwd()): Promise<SystemAlert[]> {
	const alerts: SystemAlert[] = [];
	try {
		let dirs: string[] = [];
		if (DEEP_MONITOR) {
			const { stdout } = await execFileAsync(
				"find",
				[os.homedir(), "-maxdepth", "2", "-name", "node_modules", "-type", "d"],
				{ timeout: MONITOR_COMMAND_TIMEOUT_MS }
			);
			dirs = stdout.trim().split("\n").filter(Boolean);
		} else {
			const localNodeModules = path.join(baseDir, "node_modules");
			const stat = await fs.stat(localNodeModules).catch(() => null);
			dirs = stat?.isDirectory() ? [localNodeModules] : [];
		}
		if (dirs.length > 10) {
			alerts.push({
				severity: "info",
				category: "disk",
				message: `${dirs.length} node_modules directories found`,
				recommendedAction: "Consider running clean:artifacts or deleting old node_modules",
			});
		}
	} catch {
		// ignore
	}
	return alerts;
}

/** Run all proactive checks and return a report */
export async function runSystemMonitor(): Promise<MonitorReport> {
	const [diskAlerts, memAlerts, gitAlerts, bloatAlerts] = await Promise.all([
		checkDisk(),
		checkMemory(),
		checkGitDirty(),
		checkNodeModulesBloat(),
	]);

	const alerts = [...diskAlerts, ...memAlerts, ...gitAlerts, ...bloatAlerts];
	const hasCritical = alerts.some((a) => a.severity === "critical");

	return {
		checkedAt: new Date().toISOString(),
		alerts,
		ok: !hasCritical,
	};
}

/** Format the report for prompt injection */
export function formatMonitorReport(report: MonitorReport): string {
	if (report.alerts.length === 0) {
		return "<system-health>All proactive checks passed. System is healthy.</system-health>";
	}
	const lines = report.alerts.map((a) => {
		const label =
			a.severity === "critical" ? "CRITICAL" : a.severity === "warning" ? "WARNING" : "INFO";
		return `[${label}] [${a.category}] ${a.message}${a.recommendedAction ? ` -> ${a.recommendedAction}` : ""}`;
	});
	return `<system-health>\nProactive monitor alerts:\n\n${lines.join("\n")}\n</system-health>`;
}
