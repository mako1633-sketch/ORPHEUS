/**
 * AI Red Team Dataset Parser
 *
 * Parses CSV/JSON datasets for custom probe prompt injection.
 * Supports variable substitution in probe templates ({{VAR}} syntax).
 */

export interface DatasetRow {
	[key: string]: string;
}

export interface ParsedDataset {
	success: boolean;
	rows: DatasetRow[];
	errors: string[];
	headers: string[];
	totalRows: number;
}

function splitCSVLine(line: string): string[] {
	const result: string[] = [];
	let current = "";
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		const next = line[i + 1];
		if (char === '"') {
			if (inQuotes) {
				if (next === '"') {
					current += '"';
					i++; // skip escaped quote
				} else {
					inQuotes = false; // closing quote
				}
			} else {
				inQuotes = true; // opening quote
			}
		} else if (char === "," && !inQuotes) {
			result.push(current);
			current = "";
		} else {
			current += char;
		}
	}
	result.push(current);
	return result;
}

/**
 * Parse a CSV string into rows.
 * First row is treated as headers.
 */
export function parseCSV(csv: string): ParsedDataset {
	const lines = csv.split("\n").filter((l) => l.trim().length > 0);
	if (lines.length === 0) {
		return { success: false, rows: [], errors: ["Empty CSV"], headers: [], totalRows: 0 };
	}

	const firstLine = lines[0]!;
	const headers = splitCSVLine(firstLine).map((h) => h.trim());
	const rows: DatasetRow[] = [];
	const errors: string[] = [];

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i]!;
		const values = splitCSVLine(line).map((v) => v.trim());
		if (values.length !== headers.length) {
			errors.push(`Row ${i + 1}: column count mismatch (${values.length} vs ${headers.length})`);
			continue;
		}
		const row: DatasetRow = {};
		for (let j = 0; j < headers.length; j++) {
			const key = headers[j]!;
			const val = values[j]!;
			row[key] = val;
		}
		rows.push(row);
	}

	return { success: errors.length === 0, rows, errors, headers, totalRows: rows.length };
}

/**
 * Parse a JSON dataset. Expected shape: array of objects with string values,
 * or an object with a "rows" array.
 */
export function parseJSONDataset(json: string): ParsedDataset {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (e) {
		return {
			success: false,
			rows: [],
			errors: [`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`],
			headers: [],
			totalRows: 0,
		};
	}

	let rows: unknown[];
	if (Array.isArray(parsed)) {
		rows = parsed;
	} else if (typeof parsed === "object" && parsed !== null && "rows" in parsed) {
		rows = (parsed as Record<string, unknown>).rows as unknown[];
	} else {
		return {
			success: false,
			rows: [],
			errors: ["JSON must be an array or { rows: [...] }"],
			headers: [],
			totalRows: 0,
		};
	}

	if (!Array.isArray(rows)) {
		return {
			success: false,
			rows: [],
			errors: ["rows must be an array"],
			headers: [],
			totalRows: 0,
		};
	}

	const result: DatasetRow[] = [];
	const errors: string[] = [];
	const headers = new Set<string>();

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		if (typeof row !== "object" || row === null) {
			errors.push(`Row ${i + 1}: not an object`);
			continue;
		}
		const typedRow: DatasetRow = {};
		for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
			headers.add(key);
			typedRow[key] = String(value ?? "");
		}
		result.push(typedRow);
	}

	return {
		success: errors.length === 0,
		rows: result,
		errors,
		headers: Array.from(headers),
		totalRows: result.length,
	};
}

/**
 * Substitute {{KEY}} placeholders in a template using values from a dataset row.
 */
export function substituteTemplate(template: string, row: DatasetRow): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
		return row[key] ?? `{{${key}}}`;
	});
}

/**
 * Expand a probe's prompt template across all rows in a dataset,
 * returning one prompt string per row.
 */
export function expandProbeWithDataset(
	probePrompt: string,
	dataset: ParsedDataset
): { prompts: string[]; errors: string[] } {
	const prompts: string[] = [];
	const errors: string[] = [];
	for (const row of dataset.rows) {
		const substituted = substituteTemplate(probePrompt, row);
		if (substituted.includes("{{")) {
			errors.push(`Unresolved placeholders in row: ${JSON.stringify(row)}`);
		}
		prompts.push(substituted);
	}
	return { prompts, errors };
}
