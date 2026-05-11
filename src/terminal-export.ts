/**
 * Terminal conversation export — Markdown/JSON/CSV output to workspace.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { listSessions, loadSessionSnapshot } from "./state/session-store";
import { getWorkspacePath } from "./utils/workspace-manager";

export type ExportFormat = "markdown" | "json" | "csv";

interface ExportMessage {
	role: string;
	content: string;
	timestamp: string;
}

function escapeCsv(value: string): string {
	const escaped = value.replace(/"/g, '""');
	return `"${escaped}"`;
}

function buildMarkdown(
	sessionId: string,
	title: string,
	messages: ExportMessage[],
	model: string,
	provider: string
): string {
	const timestamp = new Date().toISOString();

	const header = `# ORPHEUS Session Export\n\n`;
	const meta = `| Field | Value |\n|---|---|\n`;
	const metaRows = [
		`| Session ID | \`${sessionId}\` |`,
		`| Title | ${title || "Untitled"} |`,
		`| Exported | ${timestamp} |`,
		`| Model | ${model} |`,
		`| Provider | ${provider} |`,
		`| Messages | ${messages.length} |`,
	].join("\n");

	const body = messages
		.map((msg) => {
			const roleLabel = msg.role === "user" ? "## OPERATOR" : "## ORPHEUS";
			const timestampStr = msg.timestamp ? `\n*${msg.timestamp}*\n` : "";
			return `${roleLabel}\n\n${msg.content}\n${timestampStr}`;
		})
		.join("\n---\n\n");

	return `${header}${meta}${metaRows}\n\n---\n\n${body}\n`;
}

function buildJSON(
	sessionId: string,
	title: string,
	messages: ExportMessage[],
	model: string,
	provider: string
): string {
	const payload = {
		export: {
			version: "1.0",
			format: "json",
			exportedAt: new Date().toISOString(),
		},
		session: {
			id: sessionId,
			title: title || "Untitled",
			model,
			provider,
			messageCount: messages.length,
		},
		messages,
	};
	return JSON.stringify(payload, null, 2);
}

function buildCSV(messages: ExportMessage[]): string {
	const header = "role,timestamp,content\n";
	const rows = messages
		.map((msg) => {
			const role = escapeCsv(msg.role);
			const ts = escapeCsv(msg.timestamp || "");
			const content = escapeCsv(msg.content);
			return `${role},${ts},${content}`;
		})
		.join("\n");
	return header + rows + "\n";
}

export async function exportSession(
	sessionId: string,
	format: ExportFormat = "markdown",
	savePath?: string
): Promise<string> {
	const snapshot = await loadSessionSnapshot(sessionId);
	if (!snapshot) {
		throw new Error(`Session not found: ${sessionId}`);
	}

	const messages: ExportMessage[] =
		snapshot.conversationHistory?.map((msg) => ({
			role: msg.type === "user" ? "user" : "assistant",
			content: msg.content || "",
			timestamp: new Date().toISOString(),
		})) || [];

	const sessionInfo = (await listSessions()).find((session) => session.id === sessionId);
	const model = "unknown";
	const provider = "unknown";
	const title = sessionInfo?.title ?? "ORPHEUS Session";

	let content: string;
	let ext: string;

	switch (format) {
		case "json":
			content = buildJSON(sessionId, title, messages, model, provider);
			ext = "json";
			break;
		case "csv":
			content = buildCSV(messages);
			ext = "csv";
			break;
		default:
			content = buildMarkdown(sessionId, title, messages, model, provider);
			ext = "md";
			break;
	}

	const outDir = savePath || getWorkspacePath(sessionId) || process.cwd();
	const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const fileName = `ORPHEUS_${sessionId.slice(0, 8)}_${dateStr}.${ext}`;
	const filePath = path.join(outDir, fileName);

	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content, "utf-8");

	return filePath;
}

export async function exportLatest(format: ExportFormat = "markdown"): Promise<string> {
	const sessions = await listSessions();

	if (sessions.length === 0) {
		throw new Error("No sessions found to export.");
	}

	const latest = sessions.sort(
		(a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
	)[0];
	if (!latest) {
		throw new Error("No sessions found to export.");
	}

	return exportSession(latest.id, format);
}
