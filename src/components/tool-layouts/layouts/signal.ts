import type { ToolBody, ToolHeader, ToolLayoutConfig } from "../types";
import { registerToolLayout } from "../registry";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(record: UnknownRecord, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function extractSignalInput(input: unknown): UnknownRecord | null {
	if (!isRecord(input)) return null;
	if (typeof input.action !== "string") return null;
	return input;
}

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatSignalResult(result: unknown): string[] | null {
	if (!isRecord(result)) return null;
	const success = typeof result.success === "boolean" ? result.success : undefined;
	const action = typeof result.action === "string" ? result.action : "signal";
	const stdout = typeof result.stdout === "string" ? result.stdout : "";
	const stderr = typeof result.stderr === "string" ? result.stderr : "";
	const error = typeof result.error === "string" ? result.error : "";
	const body = stdout.trim() || stderr.trim() || error.trim();

	if (!body) {
		return [`${action}: success=${String(success ?? false)}`];
	}

	const lines = body
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter(Boolean)
		.slice(0, 4)
		.map((line) => truncate(line, 160));
	lines[0] = `${action}: ${lines[0]}`;
	return lines;
}

export const signalLayout: ToolLayoutConfig = {
	abbreviation: "signal",

	getHeader: (input): ToolHeader | null => {
		const signalInput = extractSignalInput(input);
		if (!signalInput) return null;
		return {
			secondary: String(signalInput.action),
			secondaryStyle: "italic",
		};
	},

	getBody: (input): ToolBody | null => {
		const signalInput = extractSignalInput(input);
		if (!signalInput) return null;
		const action = String(signalInput.action);
		const recipient = getString(signalInput, "recipient");
		const groupId = getString(signalInput, "groupId");
		const message = getString(signalInput, "message");

		const parts = [action];
		if (recipient) parts.push(`to ${recipient}`);
		if (groupId) parts.push(`group ${groupId}`);
		if (message) parts.push(`"${truncate(message, 80)}"`);

		return {
			lines: [{ text: parts.join(" ") }],
		};
	},

	formatResult: formatSignalResult,
};

registerToolLayout("signal", signalLayout);
