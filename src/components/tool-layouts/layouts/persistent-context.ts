import { registerToolLayout } from "../registry";
import type { ToolHeader, ToolLayoutConfig } from "../types";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string, max = 140): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export const persistentContextLayout: ToolLayoutConfig = {
	abbreviation: "ctx",

	getHeader: (input): ToolHeader | null => {
		if (!isRecord(input)) return null;
		const action = typeof input.action === "string" ? input.action : "context";
		return {
			primary: action,
			secondary: action === "append" ? "durable local memory" : undefined,
			secondaryStyle: "dim",
		};
	},

	getBody: (input) => {
		if (!isRecord(input)) return null;
		if (typeof input.content !== "string") return null;
		return { lines: [{ text: truncate(input.content.replace(/\s+/g, " ").trim()) }] };
	},

	formatResult: (result) => {
		if (!isRecord(result)) return null;
		if (result.success === false && typeof result.error === "string") return [`error: ${result.error}`];
		if (result.action === "read") {
			const content = typeof result.content === "string" ? result.content.trim() : "";
			if (!content) return ["persistent context is empty"];
			return content
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean)
				.slice(0, 5);
		}
		if (result.action === "clear") {
			return [`clear: ${result.cleared === true ? "persistent context removed" : "no change"}`];
		}
		return [
			`${String(result.action ?? "update")}: saved`,
			`path: ${String(result.path ?? "--")}`,
			result.empty === true ? "empty export" : "",
			result.truncated === true ? "truncated to newest local context" : "",
		].filter(Boolean);
	},
};

registerToolLayout("persistentContext", persistentContextLayout);
