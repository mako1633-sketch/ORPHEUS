import { promises as fs } from "node:fs";
import path from "node:path";

export interface ExportFormat {
	format: "markdown" | "json";
	title?: string;
}

export interface SessionExportResult {
	filePath: string;
	messageCount: number;
	duration: number;
}

/**
 * Export a session as Markdown or JSON.
 */
export async function exportSession(
	sessionId: string,
	options: ExportFormat
): Promise<SessionExportResult> {
	const start = Date.now();
	const { getDb } = await import("./session-store");
	const db = await getDb();

	const sessionRow = db
		.prepare("SELECT title, created_at FROM sessions WHERE id = ?")
		.get(sessionId) as { title: string; created_at: string } | undefined;

	const title = options.title ?? sessionRow?.title ?? "ORPHEUS_Session";
	const createdAt = sessionRow?.created_at ?? new Date().toISOString();

	const messages = db
		.prepare(
			`SELECT type, role, content, created_at FROM messages
			 WHERE session_id = ? ORDER BY created_at ASC`
		)
		.all(sessionId) as Array<{
		type: string;
		role: string;
		content: string;
		created_at: string;
	}>;

	const fileName = `${sanitizeFileName(title)}_${formatDate(new Date(createdAt))}.${options.format}`;
	const exportDir = path.join(process.cwd(), "exports");
	await fs.mkdir(exportDir, { recursive: true });
	const filePath = path.join(exportDir, fileName);

	if (options.format === "markdown") {
		const md = buildMarkdown(title, createdAt, messages);
		await fs.writeFile(filePath, md, "utf-8");
	} else {
		const json = buildJson(title, createdAt, messages);
		await fs.writeFile(filePath, JSON.stringify(json, null, 2), "utf-8");
	}

	return {
		filePath,
		messageCount: messages.length,
		duration: Date.now() - start,
	};
}

function buildMarkdown(
	title: string,
	createdAt: string,
	messages: Array<{ type: string; role: string; content: string; created_at: string }>
): string {
	const lines: string[] = [
		`# ${title}`,
		"",
		`**Date:** ${new Date(createdAt).toISOString()}`,
		"",
		"---",
		"",
	];

	for (const msg of messages) {
		const role = msg.role === "user" ? "OPERATOR" : "ORPHEUS";
		lines.push(`## ${role}`, "", msg.content, "", "---", "");
	}

	return lines.join("\n");
}

function buildJson(
	title: string,
	createdAt: string,
	messages: Array<{ type: string; role: string; content: string; created_at: string }>
): object {
	return {
		title,
		createdAt: new Date(createdAt).toISOString(),
		messages: messages.map((m) => ({
			role: m.role,
			content: m.content,
			timestamp: new Date(m.created_at).toISOString(),
		})),
	};
}

function sanitizeFileName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
}

function formatDate(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	const h = String(date.getHours()).padStart(2, "0");
	const min = String(date.getMinutes()).padStart(2, "0");
	return `${y}-${m}-${d}_${h}-${min}`;
}
