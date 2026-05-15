/** ORPHEUS Executive Dashboard - Report Generator */
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getAppConfigDir } from "../utils/preferences";
import { runSystemMonitor } from "./system-monitor";

const execFileAsync = promisify(execFile);
const ORPHEUS_CONFIG = getAppConfigDir();
const HOME_DIR = os.homedir();
const DEFAULT_ORPHEUS_ROOT = path.resolve(process.cwd());
const DEFAULT_ORPHEUS_SRC = path.join(DEFAULT_ORPHEUS_ROOT, "src");

/* Types */
export interface ReportData {
	generatedAt: string;
	version: string;
	health: {
		score: number;
		diskUsedPercent: number | null;
		memoryUsedPercent: number | null;
		alerts: { severity: string; message: string; action?: string }[];
	};
	velocity: {
		activeTasks: number;
		completedTasks7d: number;
		completedTasks30d: number;
		completionRate: number;
		gitCommits7d: number;
		gitCommits30d: number;
		codeChurn: number;
	};
	risk: {
		uncommittedRepos: number;
		uncommittedRepoNames: string[];
		outdatedDependencies: number;
		securityFindings: number;
		securityCritical: number;
		securityWarnings: number;
		criticalRisks: string[];
	};
	architecture: {
		totalFilesIndexed: number;
		hotspots: { file: string; references: number }[];
		orphans: { file: string }[];
	};
	reflections: {
		recentReflections: { date: string; lesson: string; taskType: string }[];
		recurringProblems: string[];
	};
	roi: {
		tasksAutonomous: number;
		tasksWithHandholding: number;
		errorRecoveryRate: number;
		totalTasksCompleted: number;
		avgCompletionTime: string;
	};
}

/* Helpers */
function loadJson(file: string): unknown {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}
function escapeHtml(value: unknown): string {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
function extractArray(data: unknown, key?: string): any[] {
	if (data == null) return [];
	if (Array.isArray(data)) return data;
	if (key && typeof data === "object") {
		const nested = (data as Record<string, unknown>)[key];
		if (Array.isArray(nested)) return nested;
		if (nested && typeof nested === "object") return Object.values(nested as Record<string, unknown>);
	}
	if (typeof data === "object") return Object.values(data as Record<string, unknown>);
	return [];
}

function walkDirectories(
	root: string,
	options: { maxDepth: number; include?: (target: string) => boolean }
): string[] {
	const results: string[] = [];
	const seen = new Set<string>();

	function visit(target: string, depth: number): void {
		if (depth > options.maxDepth) return;
		let realTarget = target;
		try {
			realTarget = path.resolve(target);
			if (seen.has(realTarget)) return;
			seen.add(realTarget);
			const entry = statSync(realTarget);
			if (!entry.isDirectory()) return;
		} catch {
			return;
		}

		if (options.include?.(realTarget)) {
			results.push(realTarget);
		}

		let entries: string[] = [];
		try {
			entries = readdirSync(realTarget);
		} catch {
			return;
		}

		for (const entry of entries) {
			if (entry === "node_modules" || entry === ".cache" || entry === "dist") continue;
			visit(path.join(realTarget, entry), depth + 1);
		}
	}

	visit(root, 0);
	return results;
}

function walkFiles(root: string, options: { maxDepth: number; extensions?: string[] }): string[] {
	const files: string[] = [];
	const extensions = options.extensions ? new Set(options.extensions.map((ext) => ext.toLowerCase())) : null;

	function visit(target: string, depth: number): void {
		if (depth > options.maxDepth) return;
		let entry: ReturnType<typeof statSync>;
		try {
			entry = statSync(target);
		} catch {
			return;
		}

		if (entry.isFile()) {
			if (!extensions || extensions.has(path.extname(target).toLowerCase())) {
				files.push(target);
			}
			return;
		}
		if (!entry.isDirectory()) return;

		let children: string[] = [];
		try {
			children = readdirSync(target);
		} catch {
			return;
		}
		for (const child of children) {
			if (child === "node_modules" || child === ".cache" || child === "dist") continue;
			visit(path.join(target, child), depth + 1);
		}
	}

	visit(root, 0);
	return files;
}

function getDesktopDir(): string {
	const desktop = path.join(HOME_DIR, "Desktop");
	return existsSync(desktop) ? desktop : HOME_DIR;
}

/* Aggregators */
async function aggregateHealth() {
	const monitor = await runSystemMonitor();
	let diskUsedPercent: number | null = null;
	let memoryUsedPercent: number | null = null;
	for (const a of monitor.alerts) {
		if (a.category === "disk") {
			const m = a.message.match(/(\d+)%/);
			if (m) diskUsedPercent = Number.parseInt(m[1] || "0", 10);
		}
		if (a.category === "memory") {
			const m = a.message.match(/(\d+)%/);
			if (m) memoryUsedPercent = Number.parseInt(m[1] || "0", 10);
		}
	}
	let score = 100;
	for (const a of monitor.alerts) {
		if (a.severity === "critical") score -= 30;
		else if (a.severity === "warning") score -= 15;
		else score -= 5;
	}
	score = Math.max(0, Math.min(100, score));
	return { score, diskUsedPercent, memoryUsedPercent, alerts: monitor.alerts };
}

async function aggregateVelocity() {
	const raw = loadJson(path.join(ORPHEUS_CONFIG, "tasks.json"));
	const tasks = extractArray(raw, "tasks");
	const activeTasks = tasks.filter(
		(t: any) => t?.status === "in_progress" || t?.state === "in_progress"
	).length;
	const completed7d = tasks.filter(
		(t: any) => t?.completedAt && Date.now() - new Date(t.completedAt).getTime() < 7 * 864e5
	).length;
	const completed30d = tasks.filter(
		(t: any) => t?.completedAt && Date.now() - new Date(t.completedAt).getTime() < 30 * 864e5
	).length;
	const totalCompleted = tasks.filter(
		(t: any) => t?.status === "completed" || t?.state === "completed"
	).length;
	const completionRate = tasks.length ? Math.round((totalCompleted / tasks.length) * 100) : 0;
	let gitCommits7d = 0;
	let gitCommits30d = 0;
	let codeChurn = 0;
	try {
		const { stdout: c7 } = await execFileAsync("git", ["rev-list", "--count", "HEAD", "--since=7.days"], {
			timeout: 5000,
		});
		gitCommits7d = Number.parseInt(c7.trim(), 10) || 0;
		const { stdout: c30 } = await execFileAsync("git", ["rev-list", "--count", "HEAD", "--since=30.days"], {
			timeout: 5000,
		});
		gitCommits30d = Number.parseInt(c30.trim(), 10) || 0;
		const { stdout: diff } = await execFileAsync("git", ["diff", "--stat", "HEAD~7..HEAD"], {
			timeout: 5000,
		});
		const m = diff.match(/(\d+) insertions?\(\+\), (\d+) deletions?\(-\)/);
		if (m) codeChurn = Number.parseInt(m[1] || "0", 10) + Number.parseInt(m[2] || "0", 10);
	} catch {}
	return {
		activeTasks,
		completedTasks7d: completed7d,
		completedTasks30d: completed30d,
		completionRate,
		gitCommits7d,
		gitCommits30d,
		codeChurn,
	};
}

/** Run live security scan using spawn (handles large output + non-zero exit). Skips in test mode. */
async function runLiveSecurityScan(): Promise<{ critical: number; warnings: number; info: number }> {
	if (process.env.ORPHEUS_TEST) return { critical: 0, warnings: 0, info: 0 };
	const scanScript = path.join(
		ORPHEUS_CONFIG,
		"workspaces",
		"4225ca70-bc89-46be-99ef-d3e82098faf2",
		"bin",
		"security-scan"
	);
	if (!existsSync(scanScript)) return { critical: 0, warnings: 0, info: 0 };

	return new Promise((resolve) => {
		let output = "";
		const child = spawn(scanScript, [], { cwd: HOME_DIR, shell: process.platform === "win32" });
		const timeout = setTimeout(() => {
			child.kill();
			resolve({
				critical: (output.match(/\[CRITICAL\]/gi) || []).length,
				warnings: (output.match(/\[WARN\]/gi) || []).length,
				info: (output.match(/\[INFO\]/gi) || []).length,
			});
		}, 60000);

		child.stdout.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.stderr.on("data", () => {
			/* ignore stderr */
		});

		child.on("close", () => {
			clearTimeout(timeout);
			resolve({
				critical: (output.match(/\[CRITICAL\]/gi) || []).length,
				warnings: (output.match(/\[WARN\]/gi) || []).length,
				info: (output.match(/\[INFO\]/gi) || []).length,
			});
		});

		child.on("error", () => {
			clearTimeout(timeout);
			resolve({ critical: 0, warnings: 0, info: 0 });
		});
	});
}

async function aggregateRisk() {
	let uncommittedRepos = 0;
	const uncommittedRepoNames: string[] = [];
	try {
		const repos = walkDirectories(HOME_DIR, {
			maxDepth: 4,
			include: (target) => path.basename(target) === ".git",
		});
		for (const gitDir of repos.slice(0, 20)) {
			try {
				const { stdout: status } = await execFileAsync(
					"git",
					["-C", path.dirname(gitDir), "status", "--porcelain"],
					{ timeout: 5000 }
				);
				if (status.trim()) {
					uncommittedRepos++;
					uncommittedRepoNames.push(path.basename(path.dirname(gitDir)));
				}
			} catch {}
		}
	} catch {}

	const securityResult = await runLiveSecurityScan();
	const securityFindings = securityResult.critical + securityResult.warnings;
	const securityCritical = securityResult.critical;
	const securityWarnings = securityResult.warnings;

	let outdatedDependencies = 0;
	if (!process.env.ORPHEUS_TEST) {
		try {
			const { stdout } = await execFileAsync("npm", ["outdated", "--json"], { timeout: 15000 });
			outdatedDependencies = Object.keys(JSON.parse(stdout)).length;
		} catch {}
	}

	const criticalRisks: string[] = [];
	if (uncommittedRepos > 3) criticalRisks.push(`${uncommittedRepos} repos with uncommitted changes`);
	if (outdatedDependencies > 5) criticalRisks.push(`${outdatedDependencies} outdated dependencies`);
	if (securityCritical > 0)
		criticalRisks.push(`${securityCritical} critical security finding${securityCritical > 1 ? "s" : ""}`);
	if (securityWarnings > 0)
		criticalRisks.push(`${securityWarnings} security warning${securityWarnings > 1 ? "s" : ""}`);

	return {
		uncommittedRepos,
		uncommittedRepoNames,
		outdatedDependencies,
		securityFindings,
		securityCritical,
		securityWarnings,
		criticalRisks,
	};
}

async function aggregateArchitecture() {
	let totalFilesIndexed = 0;
	const hotspots: { file: string; references: number }[] = [];
	try {
		totalFilesIndexed = walkFiles(DEFAULT_ORPHEUS_SRC, { maxDepth: 12, extensions: [".ts", ".tsx"] }).length;
	} catch {}
	try {
		const counts = new Map<string, number>();
		const sourceFiles = walkFiles(DEFAULT_ORPHEUS_SRC, { maxDepth: 12, extensions: [".ts", ".tsx"] });
		for (const file of sourceFiles) {
			const source = readFileSync(file, "utf8");
			const imports = source.matchAll(/from ['"]([^'"]+)['"]/g);
			for (const imp of imports) {
				const ref = (imp[1] || "").replace(/^\.\.?\//, "");
				if (ref) counts.set(ref, (counts.get(ref) || 0) + 1);
			}
		}
		const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
		for (const [file, references] of sorted) hotspots.push({ file, references });
	} catch {}
	return { totalFilesIndexed, hotspots, orphans: [] };
}

async function aggregateReflections() {
	const raw = loadJson(path.join(ORPHEUS_CONFIG, "reflections.json"));
	const reflections = extractArray(raw, "entries");
	const recent = reflections
		.slice(-5)
		.reverse()
		.map((r: any) => ({
			date: new Date(r?.createdAt ?? r?.completedAt ?? r?.date ?? Date.now()).toLocaleDateString(),
			lesson: r?.lessonLearned ?? r?.lesson ?? String(r?.whatWorked?.[0] ?? r?.goal ?? "No lesson recorded"),
			taskType: r?.taskType ?? "general",
		}));
	const problemCounts = new Map<string, number>();
	for (const r of reflections) {
		if (r?.whatFailed || r?.failure) {
			const text = String(r.whatFailed ?? r.failure).toLowerCase();
			const keywords = text.match(/\b[a-z]{5,}\b/g) || [];
			for (const kw of keywords) problemCounts.set(kw, (problemCounts.get(kw) || 0) + 1);
		}
	}
	const recurring = [...problemCounts.entries()]
		.filter(([, count]) => count >= 2)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([kw]) => kw);
	return { recentReflections: recent, recurringProblems: recurring };
}

async function aggregateRoi() {
	const raw = loadJson(path.join(ORPHEUS_CONFIG, "tasks.json"));
	const tasks = extractArray(raw, "tasks");
	const totalCompleted = tasks.filter(
		(t: any) => t?.status === "completed" || t?.state === "completed"
	).length;
	const autonomous = tasks.filter(
		(t: any) =>
			(t?.status === "completed" || t?.state === "completed") && !t?.children?.length && !t?.subtasks?.length
	).length;
	const handholding = tasks.filter(
		(t: any) =>
			(t?.status === "completed" || t?.state === "completed") &&
			((t?.children?.length ?? 0) > 0 || (t?.subtasks?.length ?? 0) > 0)
	).length;
	const blockedThenCompleted = tasks.filter(
		(t: any) => (t?.status === "completed" || t?.state === "completed") && t?.wasBlocked
	).length;
	const recoveryRate =
		autonomous + handholding > 0 ? Math.round((blockedThenCompleted / (autonomous + handholding)) * 100) : 0;
	let avgTime = 0;
	const completedWithTime = tasks.filter(
		(t: any) =>
			(t?.status === "completed" || t?.state === "completed") &&
			t?.startedAt &&
			(t?.completedAt || t?.updatedAt)
	);
	if (completedWithTime.length > 0) {
		const totalMs = completedWithTime.reduce(
			(sum: number, t: any) =>
				sum + Math.max(0, new Date(t.completedAt ?? t.updatedAt).getTime() - new Date(t.startedAt).getTime()),
			0
		);
		avgTime = Math.round(totalMs / completedWithTime.length / 36e5);
	}
	return {
		tasksAutonomous: autonomous,
		tasksWithHandholding: handholding,
		errorRecoveryRate: recoveryRate,
		totalTasksCompleted: totalCompleted,
		avgCompletionTime: avgTime > 0 ? `${avgTime}h avg` : "N/A",
	};
}

/* HTML Renderer */
function renderReport(data: ReportData): string {
	const { health, velocity, risk, architecture, reflections, roi, version, generatedAt } = data;
	const ringColor = health.score >= 80 ? "#4ade80" : health.score >= 50 ? "#facc15" : "#f87171";
	const alertBadges = health.alerts
		.map(
			(a: any) =>
				`<div class="badge ${escapeHtml(a.severity)}">[${escapeHtml(String(a.severity).toUpperCase())}] ${escapeHtml(a.message)}${a.action ? ` -> <em>${escapeHtml(a.action)}</em>` : ""}</div>`
		)
		.join("\n");
	const riskList =
		risk.criticalRisks.length > 0
			? risk.criticalRisks.map((r: string) => `<li class="risk">[risk] ${escapeHtml(r)}</li>`).join("\n")
			: '<li class="ok">[ok] No critical risks</li>';
	const hotspots = architecture.hotspots
		.slice(0, 8)
		.map(
			(h: any) =>
				`<div class="metric"><strong>${escapeHtml(h.file)}</strong><span class="muted">${escapeHtml(h.references)} refs</span></div>`
		)
		.join("\n");
	const reflectionCards = reflections.recentReflections
		.map(
			(r: any) =>
				`<div class="card"><strong>${escapeHtml(r.date)}</strong> <span class="muted">[${escapeHtml(r.taskType)}]</span><br/>${escapeHtml(r.lesson)}</div>`
		)
		.join("\n");

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ORPHEUS Executive Dashboard - ${generatedAt.split("T")[0]}</title>
<style>
:root{--bg:#0f172a;--fg:#e2e8f0;--muted:#94a3b8;--accent:#38bdf8;--ok:#4ade80;--warn:#facc15;--danger:#f87171}
*{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif}
body{background:var(--bg);color:var(--fg);line-height:1.6;max-width:960px;margin:0 auto;padding:2rem}
h1{font-size:1.8rem;margin-bottom:.2rem}h2{font-size:1.2rem;margin-top:2rem;margin-bottom:.6rem;color:var(--accent)}
.header{border-bottom:1px solid #334155;padding-bottom:1rem;margin-bottom:1.5rem}
.sub{color:var(--muted);font-size:.9rem}
.score-ring{width:120px;height:120px;border-radius:50%;border:8px solid ${ringColor};display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:700;margin:1rem 0}
.badge{padding:.5rem .8rem;border-radius:.4rem;background:#1e293b;border-left:4px solid var(--ok);margin:.3rem 0;font-size:.9rem}
.badge.warning{border-color:var(--warn)}.badge.critical{border-color:var(--danger)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem;margin-top:1rem}
.card{background:#1e293b;border-radius:.5rem;padding:1rem}
.card strong{display:block;margin-bottom:.3rem}
.muted{color:var(--muted);font-size:.85rem}
.metric{display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid #334155}
.risk{color:var(--danger)}li{list-style:none;margin:.3rem 0}.ok{color:var(--ok)}
footer{margin-top:3rem;color:var(--muted);font-size:.8rem;border-top:1px solid #334155;padding-top:1rem}
@media print{body{background:#fff;color:#000;--bg:#fff;--fg:#000;--muted:#666}}
</style>
</head>
<body>
<div class="header">
  <h1>ORPHEUS Executive Dashboard</h1>
  <p class="sub">Generated ${escapeHtml(generatedAt.split("T")[0])} &middot; Workspace: ${escapeHtml(HOME_DIR)} &middot; v${escapeHtml(version)}</p>
</div>

<h2>System Health Score</h2>
<div>
  <div class="score-ring">${health.score}</div>
  <p class="sub">Disk ${health.diskUsedPercent != null ? `${health.diskUsedPercent}%` : "N/A"} &middot; Memory ${health.memoryUsedPercent != null ? `${health.memoryUsedPercent}%` : "N/A"}</p>
</div>
${alertBadges}

<h2>Project Velocity (7d / 30d)</h2>
<div class="grid">
  <div class="card"><strong>Active Tasks</strong><div class="metric"><span>Now</span><span>${velocity.activeTasks}</span></div></div>
  <div class="card"><strong>Completed</strong><div class="metric"><span>7d / 30d</span><span>${velocity.completedTasks7d} / ${velocity.completedTasks30d}</span></div></div>
  <div class="card"><strong>Completion Rate</strong><div class="metric"><span>All time</span><span>${velocity.completionRate}%</span></div></div>
  <div class="card"><strong>Git Commits</strong><div class="metric"><span>7d / 30d</span><span>${velocity.gitCommits7d} / ${velocity.gitCommits30d}</span></div></div>
  <div class="card"><strong>Code Churn</strong><div class="metric"><span>Last 7d</span><span>${velocity.codeChurn} lines</span></div></div>
</div>

<h2>Risk Radar</h2>
<div class="card">
  <div class="metric"><span>Security Findings</span><span>${risk.securityCritical > 0 ? `<strong class="risk">${risk.securityFindings}</strong>` : risk.securityFindings}</span></div>
  <div class="metric"><span>Critical / Warning</span><span>${risk.securityCritical} / ${risk.securityWarnings}</span></div>
  <div class="metric"><span>Uncommitted Repos</span><span>${risk.uncommittedRepos}</span></div>
  <div class="metric"><span>Outdated Dependencies</span><span>${risk.outdatedDependencies}</span></div>
  <ul style="margin-top:.5rem">${riskList}</ul>
</div>

<h2>Architecture Map</h2>
<div class="card">
  <div class="metric"><span>Total Files Indexed</span><span>${architecture.totalFilesIndexed}</span></div>
  <strong style="display:block;margin-top:.8rem">Hotspots</strong>
  ${hotspots}
</div>

<h2>Team Activity</h2>
${reflectionCards}
${reflections.recurringProblems.length > 0 ? `<p class="muted" style="margin-top:.8rem">Recurring themes: ${reflections.recurringProblems.map(escapeHtml).join(", ")}</p>` : ""}

<h2>AI ROI Metrics</h2>
<div class="grid">
  <div class="card"><strong>Tasks Completed</strong><div class="metric"><span>Total</span><span>${roi.totalTasksCompleted}</span></div></div>
  <div class="card"><strong>Autonomous vs. Hand-holding</strong><div class="metric"><span>Ratio</span><span>${roi.tasksAutonomous} / ${roi.tasksWithHandholding}</span></div></div>
  <div class="card"><strong>Error Recovery Rate</strong><div class="metric"><span>Blocked -> Done</span><span>${roi.errorRecoveryRate}%</span></div></div>
  <div class="card"><strong>Avg Completion</strong><div class="metric"><span>Time</span><span>${roi.avgCompletionTime}</span></div></div>
</div>

<footer>All data sourced locally. No cloud exfiltration. ORPHEUS v${escapeHtml(version)}</footer>
</body>
</html>`;
}

/* Public API */
export async function generateReport(outputPath?: string): Promise<string> {
	if (process.env.ORPHEUS_TEST) {
		const html = renderReport({
			generatedAt: new Date().toISOString(),
			version: "1.0",
			health: { score: 90, diskUsedPercent: null, memoryUsedPercent: null, alerts: [] },
			velocity: {
				activeTasks: 0,
				completedTasks7d: 0,
				completedTasks30d: 0,
				completionRate: 0,
				gitCommits7d: 0,
				gitCommits30d: 0,
				codeChurn: 0,
			},
			risk: {
				uncommittedRepos: 0,
				uncommittedRepoNames: [],
				outdatedDependencies: 0,
				securityFindings: 0,
				securityCritical: 0,
				securityWarnings: 0,
				criticalRisks: [],
			},
			architecture: { totalFilesIndexed: 0, hotspots: [], orphans: [] },
			reflections: { recentReflections: [], recurringProblems: [] },
			roi: {
				tasksAutonomous: 0,
				tasksWithHandholding: 0,
				errorRecoveryRate: 0,
				totalTasksCompleted: 0,
				avgCompletionTime: "N/A",
			},
		});
		const out =
			outputPath ??
			path.join(getDesktopDir(), `orpheus-report-${new Date().toISOString().split("T")[0]}.html`);
		mkdirSync(path.dirname(out), { recursive: true });
		writeFileSync(out, html, "utf8");
		return out;
	}
	const data: ReportData = {
		generatedAt: new Date().toISOString(),
		version: "1.0",
		health: await aggregateHealth(),
		velocity: await aggregateVelocity(),
		risk: await aggregateRisk(),
		architecture: await aggregateArchitecture(),
		reflections: await aggregateReflections(),
		roi: await aggregateRoi(),
	};
	const html = renderReport(data);
	const out =
		outputPath ?? path.join(getDesktopDir(), `orpheus-report-${new Date().toISOString().split("T")[0]}.html`);
	mkdirSync(path.dirname(out), { recursive: true });
	writeFileSync(out, html, "utf8");
	return out;
}
