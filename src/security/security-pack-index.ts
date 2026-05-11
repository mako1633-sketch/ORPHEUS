import { promises as fs } from "node:fs";
import path from "node:path";

export interface SecurityPackIndexEntry {
	generatedAt: string;
	clientName: string;
	reportPath: string;
	portalPath: string;
	manifestPath: string;
	assessmentRecordId: string;
	score: number;
	risk: string;
	findings: number;
	openIssues: number;
	overdueIssues: number;
	verifiedIssues: number;
}

export interface SecurityPackIndex {
	clientName: string;
	updatedAt: string;
	entries: SecurityPackIndexEntry[];
}

export interface SecurityPackIndexResult {
	indexPath: string;
	indexJsonPath: string;
	index: SecurityPackIndex;
	html: string;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function relativeLink(fromDir: string, target: string): string {
	return path.relative(fromDir, target).replace(/\\/g, "/") || path.basename(target);
}

async function readIndex(indexJsonPath: string, clientName: string): Promise<SecurityPackIndex> {
	try {
		const raw = await fs.readFile(indexJsonPath, "utf8");
		const parsed = JSON.parse(raw) as Partial<SecurityPackIndex>;
		return {
			clientName: parsed.clientName ?? clientName,
			updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
			entries: Array.isArray(parsed.entries) ? (parsed.entries as SecurityPackIndexEntry[]) : [],
		};
	} catch {
		return { clientName, updatedAt: new Date(0).toISOString(), entries: [] };
	}
}

export function buildSecurityPackIndexHtml(index: SecurityPackIndex, indexDir: string): string {
	const rows =
		index.entries.length > 0
			? index.entries
					.map(
						(entry) =>
							`<tr><td>${escapeHtml(entry.generatedAt)}</td><td>${entry.score}/100</td><td>${escapeHtml(entry.risk)}</td><td>${entry.findings}</td><td>${entry.openIssues}</td><td>${entry.overdueIssues}</td><td>${entry.verifiedIssues}</td><td><a href="${escapeHtml(relativeLink(indexDir, entry.portalPath))}">Portal</a> <a href="${escapeHtml(relativeLink(indexDir, entry.reportPath))}">Report</a> <a href="${escapeHtml(relativeLink(indexDir, entry.manifestPath))}">Manifest</a></td></tr>`
					)
					.join("")
			: `<tr><td colspan="8">No evidence packs have been generated yet.</td></tr>`;

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(index.clientName)} Evidence Pack Index</title>
<style>
:root{color-scheme:dark;--bg:#05070d;--panel:#0b0e19;--line:#25304a;--text:#f8fbff;--muted:#8fa3b7;--cyan:#00e5ff;--magenta:#ff3cc7;--amber:#ffd166}
*{box-sizing:border-box}
body{margin:0;font-family:Inter,Arial,Helvetica,sans-serif;background:radial-gradient(circle at top left,#151a2b 0,#05070d 40%,#02040a 100%);color:var(--text)}
header{padding:26px 32px;background:linear-gradient(90deg,rgba(0,229,255,.08),rgba(255,60,199,.08));border-bottom:1px solid var(--line)}
main{padding:24px 32px;max-width:1180px;margin:auto}
h1{margin:0 0 8px;font-size:26px}.label{color:var(--muted);font-size:12px;text-transform:uppercase}
table{width:100%;border-collapse:collapse;background:rgba(11,14,25,.96);border:1px solid var(--line)}
th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{color:var(--muted);font-weight:700;font-size:12px;text-transform:uppercase}
tr:hover td{background:rgba(0,229,255,.04)}
a{color:var(--cyan);margin-right:10px;text-decoration:none}
a:hover{color:var(--magenta)}
td:nth-child(2){color:var(--amber);font-weight:700}
@media (max-width:860px){header,main{padding-left:18px;padding-right:18px}table{font-size:13px}}
</style>
</head>
<body>
<header>
<h1>${escapeHtml(index.clientName)} Evidence Pack Index</h1>
<div class="label">Updated by ORPHEUS at ${escapeHtml(index.updatedAt)}</div>
</header>
<main>
<table>
<thead><tr><th>Generated</th><th>Score</th><th>Risk</th><th>Findings</th><th>Open</th><th>Overdue</th><th>Verified</th><th>Artifacts</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</main>
</body>
</html>`;
}

export async function updateSecurityPackIndex(params: {
	outputDir: string;
	entry: SecurityPackIndexEntry;
}): Promise<SecurityPackIndexResult> {
	const indexPath = path.join(params.outputDir, "index.html");
	const indexJsonPath = path.join(params.outputDir, "index.json");
	const existing = await readIndex(indexJsonPath, params.entry.clientName);
	const entries = [
		params.entry,
		...existing.entries.filter((entry) => entry.manifestPath !== params.entry.manifestPath),
	].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
	const index: SecurityPackIndex = {
		clientName: params.entry.clientName,
		updatedAt: new Date().toISOString(),
		entries,
	};
	const html = buildSecurityPackIndexHtml(index, params.outputDir);

	await fs.writeFile(indexJsonPath, JSON.stringify(index, null, 2), "utf8");
	await fs.writeFile(indexPath, html, "utf8");

	return { indexPath, indexJsonPath, index, html };
}
