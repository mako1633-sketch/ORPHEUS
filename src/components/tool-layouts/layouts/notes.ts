import { registerToolLayout } from "../registry";
import type { ToolHeader, ToolLayoutConfig } from "../types";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string, max = 120): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export const notesLayout: ToolLayoutConfig = {
	abbreviation: "note",

	getHeader: (input): ToolHeader | null => {
		if (!isRecord(input)) return null;
		const action = typeof input.action === "string" ? input.action : "notes";
		const title = typeof input.title === "string" ? input.title : undefined;
		return {
			primary: action,
			secondary: title ? truncate(title, 80) : undefined,
			secondaryStyle: "dim",
		};
	},

	getBody: (input) => {
		if (!isRecord(input)) return null;
		if (input.action === "create" && typeof input.content === "string") {
			const preview = input.content.replace(/\s+/g, " ").trim();
			return { lines: [{ text: truncate(preview || "(empty note)") }] };
		}
		if (input.action === "list") {
			return { lines: [{ text: `recent notes: ${String(input.count ?? 10)}` }] };
		}
		return null;
	},

	formatResult: (result) => {
		if (!isRecord(result)) return null;
		if (result.success === false && typeof result.error === "string") return [`error: ${result.error}`];

		if (result.action === "create") {
			return [`saved: ${String(result.title ?? "Untitled note")}`, `path: ${String(result.path ?? "--")}`];
		}

		if (result.action === "list") {
			const notes = Array.isArray(result.notes) ? result.notes : [];
			if (notes.length === 0)
				return [`notes directory: ${String(result.notesDir ?? "--")}`, "no notes found"];
			return notes.slice(0, 5).map((note, idx) => {
				if (!isRecord(note)) return `${idx + 1}. (unknown note)`;
				return `${idx + 1}. ${String(note.title ?? "Untitled note")}`;
			});
		}

		return null;
	},
};

registerToolLayout("notes", notesLayout);
