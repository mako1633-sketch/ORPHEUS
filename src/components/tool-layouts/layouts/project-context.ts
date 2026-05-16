import { registerToolLayout } from "../registry";
import type { ToolBody, ToolLayoutConfig } from "../types";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatArray(value: unknown, limit: number): string {
	if (!Array.isArray(value) || value.length === 0) return "--";
	return value.slice(0, limit).map(String).join(", ");
}

function formatScripts(pkg: UnknownRecord | null): string {
	if (!pkg || !isRecord(pkg.scripts)) return "--";
	return Object.keys(pkg.scripts).slice(0, 8).join(", ") || "--";
}

function formatResult(result: unknown): string[] | null {
	if (!isRecord(result)) return null;
	if (result.success === false && typeof result.error === "string")
		return [`error: ${result.error}`];

	const pkg = isRecord(result.package) ? result.package : null;
	const gitStatus = Array.isArray(result.gitStatus) ? result.gitStatus : [];
	const files = Array.isArray(result.files) ? result.files : [];

	const lines = [
		`root: ${String(result.root ?? "--")}`,
		`package: ${pkg?.name ? String(pkg.name) : "--"} · manager ${String(result.packageManager ?? "--")}`,
		`scripts: ${formatScripts(pkg)}`,
		`important: ${formatArray(result.importantFiles, 8)}`,
		`git: ${gitStatus.length > 0 ? gitStatus.slice(0, 3).map(String).join(" · ") : "--"}`,
		`files: ${files.length} returned${result.truncated ? " · truncated" : ""}`,
	];

	return lines;
}

export const projectContextLayout: ToolLayoutConfig = {
	abbreviation: "proj",
	getHeader: (input): { primary: string } => {
		const root = isRecord(input) && typeof input.root === "string" ? input.root : "current project";
		return { primary: root };
	},
	getBody: (input): ToolBody => {
		const maxFiles = isRecord(input) && typeof input.maxFiles === "number" ? input.maxFiles : 160;
		return { lines: [{ text: `Scanning project structure · max ${maxFiles} entries` }] };
	},
	formatResult,
};

registerToolLayout("projectContext", projectContextLayout);
