import { promises as fs } from "node:fs";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { getAppConfigDir } from "../../utils/preferences";

const MAX_LIST_COUNT = 20;

function getNotesDir(): string {
	return path.join(getAppConfigDir(), "notes");
}

function slugifyTitle(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return slug || "note";
}

function timestampForFilename(date = new Date()): string {
	return date.toISOString().replace(/[:.]/g, "-");
}

export async function createNote({
	title,
	content,
}: {
	title?: string;
	content: string;
}): Promise<{
	success: boolean;
	action: "create";
	path?: string;
	title: string;
	bytesWritten?: number;
	error?: string;
}> {
	const noteTitle = title?.trim() || content.trim().split("\n")[0]?.slice(0, 80) || "Untitled note";
	const filename = `${timestampForFilename()}-${slugifyTitle(noteTitle)}.md`;
	const notesDir = getNotesDir();
	const notePath = path.join(notesDir, filename);
	const payload = `# ${noteTitle}\n\n${content.trim()}\n`;

	try {
		await fs.mkdir(notesDir, { recursive: true });
		await fs.writeFile(notePath, payload, "utf8");
		return {
			success: true,
			action: "create",
			path: notePath,
			title: noteTitle,
			bytesWritten: Buffer.byteLength(payload, "utf8"),
		};
	} catch (error) {
		return {
			success: false,
			action: "create",
			title: noteTitle,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function listNotes({
	count = 10,
}: {
	count?: number;
}): Promise<{
	success: boolean;
	action: "list";
	notesDir: string;
	notes?: Array<{ path: string; title: string; updatedAt: string; sizeBytes: number }>;
	error?: string;
}> {
	const notesDir = getNotesDir();
	const safeCount = Math.max(1, Math.min(MAX_LIST_COUNT, Math.floor(count)));

	try {
		await fs.mkdir(notesDir, { recursive: true });
		const entries = await fs.readdir(notesDir, { withFileTypes: true });
		const notes = await Promise.all(
			entries
				.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
				.map(async (entry) => {
					const notePath = path.join(notesDir, entry.name);
					const stat = await fs.stat(notePath);
					const content = await fs.readFile(notePath, "utf8").catch(() => "");
					const firstHeading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
					return {
						path: notePath,
						title: firstHeading || entry.name,
						updatedAt: stat.mtime.toISOString(),
						sizeBytes: stat.size,
					};
				})
		);

		notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

		return {
			success: true,
			action: "list",
			notesDir,
			notes: notes.slice(0, safeCount),
		};
	} catch (error) {
		return {
			success: false,
			action: "list",
			notesDir,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export const notes = tool({
	description:
		"Create or list local ORPHEUS notes. Use create when the user asks to remember, save, jot down, or take a note. Notes are stored as markdown files in the ORPHEUS config directory.",
	inputSchema: z.discriminatedUnion("action", [
		z.object({
			action: z.literal("create"),
			title: z.string().optional().describe("Optional short title for the note."),
			content: z.string().min(1).describe("The note content to save."),
		}),
		z.object({
			action: z.literal("list"),
			count: z
				.number()
				.optional()
				.default(10)
				.describe("Maximum number of recent notes to return."),
		}),
	]),
	execute: async (input) => {
		if (input.action === "create") {
			return createNote(input);
		}
		return listNotes(input);
	},
});
