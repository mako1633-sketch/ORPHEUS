import { registerToolLayout } from "../registry";
import type { ToolHeader, ToolLayoutConfig } from "../types";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const screenshotLayout: ToolLayoutConfig = {
	abbreviation: "shot",

	getHeader: (input): ToolHeader | null => {
		if (!isRecord(input)) return { primary: "desktop capture" };
		const label = typeof input.label === "string" && input.label.trim() ? input.label.trim() : "desktop";
		return {
			primary: label,
			secondary: input.includeCursor === true ? "with cursor" : undefined,
			secondaryStyle: "dim",
		};
	},

	getBody: () => ({
		lines: [{ text: "macOS screencapture requires approval before saving the image" }],
	}),

	formatResult: (result) => {
		if (!isRecord(result)) return null;
		if (result.success === false) {
			return [`error: ${String(result.error ?? "screenshot failed")}`];
		}
		return [`saved: ${String(result.path ?? "--")}`];
	},
};

registerToolLayout("screenshot", screenshotLayout);
