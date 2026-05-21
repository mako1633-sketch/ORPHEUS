/**
 * AI Red Team Live Dashboard
 *
 * Generates visual risk dashboards in Markdown, JSON, and HTML.
 * Includes trend charts, severity blocks, and category breakdowns.
 */

import type { OverallRiskScore, CategoryRiskScore } from "./risk-scorer";
import type { ScheduledRunHistory } from "./scheduler";

export interface DashboardMetric {
	label: string;
	value: string | number;
	trend?: "up" | "down" | "flat";
	change?: number;
}

export interface DashboardChart {
	title: string;
	type: "bar" | "line" | "gauge" | "table";
	data: unknown[];
	labels?: string[];
}

export interface DashboardSeverityBlock {
	severity: "low" | "medium" | "high" | "critical";
	count: number;
	percentage: number;
	label: string;
}

export interface DashboardData {
	title: string;
	timestamp: string;
	overallScore: number;
	overallSeverity: string;
	metrics: DashboardMetric[];
	severityBlocks: DashboardSeverityBlock[];
	categoryScores: CategoryRiskScore[];
	charts: DashboardChart[];
	history?: ScheduledRunHistory;
}

function severityColor(sev: string): string {
	switch (sev) {
		case "critical":
			return "#d32f2f";
		case "high":
			return "#f57c00";
		case "medium":
			return "#fbc02d";
		case "low":
			return "#388e3c";
		default:
			return "#757575";
	}
}

function severityEmoji(sev: string): string {
	switch (sev) {
		case "critical":
			return "🔴";
		case "high":
			return "🟠";
		case "medium":
			return "🟡";
		case "low":
			return "🟢";
		default:
			return "⚪";
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

function computeSeverityBlocks(score: OverallRiskScore): DashboardSeverityBlock[] {
	const criticalCount = score.categoryScores.filter((c) => c.severity === "critical").length;
	const highCount = score.categoryScores.filter((c) => c.severity === "high").length;
	const mediumCount = score.categoryScores.filter((c) => c.severity === "medium").length;
	const lowCount = score.categoryScores.filter((c) => c.severity === "low").length;
	const totalCategories = Math.max(score.categoryScores.length, 1);

	return [
		{
			severity: "critical",
			count: criticalCount,
			percentage: Math.round((criticalCount / totalCategories) * 100),
			label: "Critical",
		},
		{
			severity: "high",
			count: highCount,
			percentage: Math.round((highCount / totalCategories) * 100),
			label: "High",
		},
		{
			severity: "medium",
			count: mediumCount,
			percentage: Math.round((mediumCount / totalCategories) * 100),
			label: "Medium",
		},
		{
			severity: "low",
			count: lowCount,
			percentage: Math.round((lowCount / totalCategories) * 100),
			label: "Low",
		},
	];
}

function computeMetrics(
	score: OverallRiskScore,
	durationMs: number,
	previousScore?: OverallRiskScore
): DashboardMetric[] {
	const metrics: DashboardMetric[] = [
		{ label: "Overall Score", value: `${score.overallScore} / 100` },
		{ label: "Failed Probes", value: score.failedProbes.length },
		{ label: "Passed Probes", value: score.passedProbes.length },
		{ label: "Duration", value: `${durationMs}ms` },
	];

	if (previousScore) {
		const change = score.overallScore - previousScore.overallScore;
		// We just created metrics with 4 elements above, so index 0 is guaranteed
		(metrics[0] as DashboardMetric).change = change;
		(metrics[0] as DashboardMetric).trend = change > 0 ? "up" : change < 0 ? "down" : "flat";
	}

	return metrics;
}

/**
 * Build dashboard data from a risk score and optional history.
 */
export function buildDashboardData(options: {
	title?: string;
	score: OverallRiskScore;
	durationMs: number;
	totalProbes: number;
	history?: ScheduledRunHistory;
	previousScore?: OverallRiskScore;
}): DashboardData {
	const { title, score, durationMs, history, previousScore } = options;
	const charts: DashboardChart[] = [
		{
			title: "Category Risk Scores",
			type: "bar",
			data: score.categoryScores.map((c) => c.weightedScore),
			labels: score.categoryScores.map((c) => c.category),
		},
		{
			title: "Pass / Fail by Category",
			type: "table",
			data: score.categoryScores.map((c) => ({
				category: c.category,
				passed: c.passed,
				failed: c.failed,
				errors: c.errors,
				total: c.total,
			})),
		},
	];

	if (history && history.results.length > 1) {
		charts.push({
			title: "Score Trend (Last 10 Runs)",
			type: "line",
			data: history.results.slice(-10).map((r) => r.riskScore ?? 0),
			labels: history.results.slice(-10).map((_, i) => `Run ${i + 1}`),
		});
	}

	return {
		title: title ?? "AI Red Team Dashboard",
		timestamp: new Date().toISOString(),
		overallScore: score.overallScore,
		overallSeverity: score.overallSeverity,
		metrics: computeMetrics(score, durationMs, previousScore),
		severityBlocks: computeSeverityBlocks(score),
		categoryScores: score.categoryScores,
		charts,
		history,
	};
}

/**
 * Generate a visual Markdown dashboard.
 */
export function generateDashboardMarkdown(data: DashboardData): string {
	const lines: string[] = [
		`# ${data.title}`,
		"",
		`> **Generated:** ${data.timestamp}`,
		`> **Overall Risk:** ${severityEmoji(data.overallSeverity)} ${data.overallSeverity.toUpperCase()} (${data.overallScore}/100)`,
		"",
		"## Metrics",
		"",
	];

	for (const m of data.metrics) {
		const trend = m.trend ? (m.trend === "up" ? "📈" : m.trend === "down" ? "📉" : "➡️") : "";
		const change =
			m.change !== undefined ? ` (${m.change > 0 ? "+" : ""}${m.change.toFixed(1)})` : "";
		lines.push(`- **${m.label}:** ${m.value} ${trend}${change}`);
	}

	lines.push("", "## Severity Breakdown", "");
	for (const block of data.severityBlocks) {
		lines.push(
			`- ${severityEmoji(block.severity)} **${block.label}:** ${block.count} (${block.percentage}%)`
		);
	}

	lines.push("", "## Category Scores", "");
	lines.push("| Category | Severity | Passed | Failed | Errors | Total | Weighted |");
	lines.push("| --- | --- | --- | --- | --- | --- | --- |");
	for (const cat of data.categoryScores) {
		lines.push(
			`| ${cat.category} | ${severityEmoji(cat.severity)} ${cat.severity.toUpperCase()} | ${cat.passed} | ${cat.failed} | ${cat.errors} | ${cat.total} | ${cat.weightedScore} |`
		);
	}

	if (data.charts.length > 0) {
		lines.push("", "## Charts", "");
		for (const chart of data.charts) {
			lines.push(`### ${chart.title}`, "");
			if (chart.type === "bar" || chart.type === "line") {
				lines.push("```");
				for (let i = 0; i < chart.data.length; i++) {
					const label = chart.labels?.[i] ?? `${i}`;
					const value = Number(chart.data[i]);
					const bar = "█".repeat(Math.max(0, Math.round(value / 5)));
					lines.push(`${label.padEnd(20)} ${bar} ${value.toFixed(1)}`);
				}
				lines.push("```", "");
			} else if (chart.type === "table") {
				lines.push("```json");
				lines.push(JSON.stringify(chart.data, null, 2));
				lines.push("```", "");
			}
		}
	}

	if (data.history) {
		lines.push("", "## Run History", "");
		lines.push(`- **Total Runs:** ${data.history.totalRuns}`);
		lines.push(`- **Last Run:** ${data.history.lastRunAt ?? "N/A"}`);
		lines.push(`- **Next Run:** ${data.history.nextRunAt ?? "N/A"}`);
		lines.push(`- **Is Running:** ${data.history.isRunning ? "Yes" : "No"}`);
	}

	lines.push("", "---", "", "*Dashboard generated by ORPHEUS AI Red Teaming.*");
	return lines.join("\n");
}

/**
 * Generate a JSON dashboard payload for API consumption or chart libraries.
 */
export function generateDashboardJSON(data: DashboardData): string {
	return JSON.stringify(data, null, 2);
}

/**
 * Generate a self-contained HTML dashboard with inline CSS.
 */
export function generateDashboardHTML(data: DashboardData): string {
	const severityBlocks = data.severityBlocks
		.map(
			(b) => `
    <div class="severity-block" style="border-left: 6px solid ${severityColor(b.severity)};">
      <div class="severity-label">${severityEmoji(b.severity)} ${escapeHtml(b.label)}</div>
      <div class="severity-count">${b.count}</div>
      <div class="severity-pct">${b.percentage}%</div>
    </div>
  `
		)
		.join("");

	const categoryRows = data.categoryScores
		.map(
			(c) => `
    <tr>
      <td>${escapeHtml(c.category)}</td>
      <td style="color:${severityColor(c.severity)}">${severityEmoji(c.severity)} ${c.severity.toUpperCase()}</td>
      <td>${c.passed}</td>
      <td>${c.failed}</td>
      <td>${c.errors}</td>
      <td>${c.total}</td>
      <td>${c.weightedScore}</td>
    </tr>
  `
		)
		.join("");

	const metricCards = data.metrics
		.map((m) => {
			const trend = m.trend
				? `<span class="trend" style="font-size:1.2rem">${m.trend === "up" ? "📈" : m.trend === "down" ? "📉" : "➡️"}</span>`
				: "";
			const change =
				m.change !== undefined
					? `<div class="change">${m.change > 0 ? "+" : ""}${m.change.toFixed(1)}</div>`
					: "";
			return `
    <div class="metric-card">
      <div class="metric-label">${escapeHtml(m.label)}</div>
      <div class="metric-value">${escapeHtml(m.value)} ${trend}</div>
      ${change}
    </div>
  `;
		})
		.join("");

	const asciiCharts = data.charts
		.map((chart) => {
			if (chart.type !== "bar" && chart.type !== "line") return "";
			const bars = chart.data
				.map((d, i) => {
					const label = (chart.labels?.[i] ?? `${i}`).padEnd(20);
					const value = Number(d);
					const bar = "█".repeat(Math.max(0, Math.round(value / 5)));
					return `<div class="bar-line"><span class="bar-label">${escapeHtml(label)}</span> <span class="bar">${bar}</span> <span class="bar-value">${Number.isFinite(value) ? value.toFixed(1) : "0.0"}</span></div>`;
				})
				.join("");
			return `
      <div class="chart">
        <h3>${escapeHtml(chart.title)}</h3>
        <div class="ascii-chart">${bars}</div>
      </div>
    `;
		})
		.join("");

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(data.title)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 2rem; }
  h1 { margin: 0 0 0.5rem; }
  .meta { color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.5rem; }
  .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .metric-card { background: #1e293b; border-radius: 8px; padding: 1rem; }
  .metric-label { font-size: 0.85rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
  .metric-value { font-size: 1.5rem; font-weight: 700; margin-top: 0.25rem; }
  .change { font-size: 0.85rem; color: #94a3b8; }
  .severity-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .severity-block { background: #1e293b; border-radius: 8px; padding: 1rem; }
  .severity-label { font-size: 0.85rem; color: #94a3b8; }
  .severity-count { font-size: 2rem; font-weight: 700; margin: 0.25rem 0; }
  .severity-pct { font-size: 0.85rem; color: #94a3b8; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; }
  th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #334155; }
  th { color: #94a3b8; font-size: 0.85rem; text-transform: uppercase; }
  .chart { background: #1e293b; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
  .chart h3 { margin: 0 0 0.75rem; font-size: 1rem; }
  .ascii-chart { font-family: monospace; font-size: 0.9rem; line-height: 1.6; }
  .bar-label { display: inline-block; width: 180px; color: #94a3b8; }
  .bar { color: #60a5fa; }
  .bar-value { color: #e2e8f0; margin-left: 0.5rem; }
</style>
</head>
<body>
  <h1>${escapeHtml(data.title)}</h1>
  <div class="meta">Generated: ${data.timestamp} — Overall Risk: ${severityEmoji(data.overallSeverity)} ${data.overallSeverity.toUpperCase()} (${data.overallScore}/100)</div>

  <div class="metrics">
    ${metricCards}
  </div>

  <div class="severity-grid">
    ${severityBlocks}
  </div>

  <table>
    <thead>
      <tr><th>Category</th><th>Severity</th><th>Passed</th><th>Failed</th><th>Errors</th><th>Total</th><th>Weighted</th></tr>
    </thead>
    <tbody>
      ${categoryRows}
    </tbody>
  </table>

  ${asciiCharts}

  <div class="meta" style="margin-top:2rem;">Dashboard generated by ORPHEUS AI Red Teaming.</div>
</body>
</html>
`;
}
