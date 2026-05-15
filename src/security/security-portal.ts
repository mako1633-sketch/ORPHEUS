import { summarizeRemediationSla } from "./remediation-sla";
import type { SecurityControlMapping } from "./security-control-mapping";
import type { SecurityEvidenceManifest } from "./security-evidence-manifest";
import type { SecurityEvidencePackInput } from "./security-evidence-pack";

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function riskClass(risk: string): string {
	if (/high/i.test(risk)) return "risk-high";
	if (/medium/i.test(risk)) return "risk-medium";
	return "risk-low";
}

function countLedger(input: SecurityEvidencePackInput, status: string): number {
	return (input.ledger ?? []).filter((issue) => issue.status === status).length;
}

function controlRows(mappings: SecurityControlMapping[]): string {
	return mappings
		.map(
			(mapping) =>
				`<tr><td>${escapeHtml(mapping.framework)}</td><td>${escapeHtml(mapping.title)}</td><td><span class="pill ${escapeHtml(mapping.status)}">${escapeHtml(mapping.status)}</span></td><td>${escapeHtml(mapping.gaps.join("; ") || "None")}</td></tr>`
		)
		.join("");
}

function ledgerRows(input: SecurityEvidencePackInput): string {
	const ledger = input.ledger ?? [];
	if (ledger.length === 0) {
		return `<tr><td colspan="6">No remediation ledger issues are currently tracked.</td></tr>`;
	}
	return ledger
		.map((issue) => {
			const state = summarizeRemediationSla([issue]).states[0];
			const dueStatus = state?.overdue ? `${state.overdueDays} day(s) overdue` : "on track";
			return `<tr><td>${escapeHtml(issue.title)}</td><td>${escapeHtml(issue.severity)}</td><td><span class="pill ${escapeHtml(issue.status)}">${escapeHtml(issue.status)}</span></td><td>${escapeHtml(issue.dueDate ?? state?.dueDate ?? "not set")}</td><td>${escapeHtml(dueStatus)}</td><td>${escapeHtml(issue.lastSeenAssessmentId)}</td></tr>`;
		})
		.join("");
}

export function buildSecurityPortalHtml(params: {
	input: SecurityEvidencePackInput;
	controlMappings: SecurityControlMapping[];
	manifest?: SecurityEvidenceManifest;
	generatedAt: Date;
}): string {
	const { input, controlMappings, manifest, generatedAt } = params;
	const slaSummary = summarizeRemediationSla(input.ledger ?? [], generatedAt);
	const openIssues = countLedger(input, "open") + countLedger(input, "in-progress");
	const verifiedIssues = countLedger(input, "verified");
	const sync = input.ledgerSync;
	const artifactRows =
		manifest?.artifacts
			.map(
				(artifact) =>
					`<tr><td>${escapeHtml(artifact.path)}</td><td>${artifact.bytes}</td><td><code>${artifact.sha256}</code></td></tr>`
			)
			.join("") ?? `<tr><td colspan="3">Manifest generated after portal render.</td></tr>`;

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.clientName)} Security Portal</title>
<style>
:root{color-scheme:dark;--bg:#05070d;--panel:#0b0e19;--panel2:#111827;--line:#25304a;--text:#f8fbff;--muted:#8fa3b7;--cyan:#00e5ff;--magenta:#ff3cc7;--hot:#ff375f;--amber:#ffd166;--violet:#6b5cff}
*{box-sizing:border-box}
body{margin:0;font-family:Inter,Arial,Helvetica,sans-serif;background:radial-gradient(circle at top left,#151a2b 0,#05070d 38%,#02040a 100%);color:var(--text)}
header{padding:30px 36px;background:linear-gradient(90deg,rgba(0,229,255,.08),rgba(255,60,199,.08));border-bottom:1px solid var(--line)}
main{padding:28px 36px;max-width:1180px;margin:auto}
h1,h2{margin:0 0 14px}
h1{font-size:28px}h2{color:var(--cyan);font-size:18px}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}
.card{background:linear-gradient(180deg,rgba(17,24,39,.96),rgba(11,14,25,.96));border:1px solid var(--line);border-left-color:var(--cyan);border-radius:6px;padding:16px}
.metric{font-size:30px;font-weight:800}
.label{color:var(--muted);font-size:12px;text-transform:uppercase}
.risk-high{color:var(--hot)}.risk-medium{color:var(--amber)}.risk-low{color:#39ffb6}
table{width:100%;border-collapse:collapse;background:rgba(11,14,25,.96);border:1px solid var(--line);margin:12px 0 26px}
th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{color:var(--muted);font-weight:700;font-size:12px;text-transform:uppercase}
tr:hover td{background:rgba(0,229,255,.04)}
.pill{display:inline-block;border-radius:6px;padding:3px 8px;background:#182033;color:var(--text);font-size:12px}
.confirmed,.verified{background:#08291d;color:#39ffb6}.partial,.in-progress{background:#33280a;color:var(--amber)}.unknown,.open{background:#351624;color:#ff9adf}.failed{background:#3a121b;color:var(--hot)}
code{font-size:12px;word-break:break-all;color:#7df9ff}
@media (max-width:860px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}header,main{padding-left:18px;padding-right:18px}}
</style>
</head>
<body>
<header>
<h1>${escapeHtml(input.clientName)} Security Engagement Portal</h1>
<div class="label">Generated by ORPHEUS at ${escapeHtml(generatedAt.toISOString())}</div>
</header>
<main>
<section class="grid">
<div class="card"><div class="metric">${input.report.score}/100</div><div class="label">Security Score</div></div>
<div class="card"><div class="metric ${riskClass(input.report.risk)}">${escapeHtml(input.report.risk)}</div><div class="label">Risk</div></div>
<div class="card"><div class="metric">${openIssues}</div><div class="label">Open Ledger Issues</div></div>
<div class="card"><div class="metric">${slaSummary.overdueCount}</div><div class="label">Overdue SLA Items</div></div>
</section>
<section class="grid">
<div class="card"><div class="metric">${sync?.openedIssueIds.length ?? 0}</div><div class="label">New Findings</div></div>
<div class="card"><div class="metric">${sync?.unchangedIssueIds.length ?? 0}</div><div class="label">Still Present</div></div>
<div class="card"><div class="metric">${verifiedIssues}</div><div class="label">Verified Resolved</div></div>
<div class="card"><div class="metric">${controlMappings.length}</div><div class="label">Mapped Controls</div></div>
</section>
<h2>Control Map</h2>
<table><thead><tr><th>Framework</th><th>Control</th><th>Status</th><th>Gaps</th></tr></thead><tbody>${controlRows(controlMappings)}</tbody></table>
<h2>Remediation Ledger</h2>
<table><thead><tr><th>Issue</th><th>Severity</th><th>Status</th><th>Due</th><th>SLA</th><th>Last Seen</th></tr></thead><tbody>${ledgerRows(input)}</tbody></table>
<h2>Evidence Manifest</h2>
<table><thead><tr><th>Artifact</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody>${artifactRows}</tbody></table>
</main>
</body>
</html>`;
}
