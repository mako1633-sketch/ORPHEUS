/**
 * AI Red Team Custom Probe Registry
 *
 * Load and validate custom probes from JSON/YAML files or inline definitions.
 * Merges with built-in probes for unified execution.
 */

import type { AIProbe, ProbeCategory, ProbeSeverity } from "./probe-library";

export interface CustomProbeDefinition {
	id: string;
	title: string;
	category: ProbeCategory;
	severity: ProbeSeverity;
	description: string;
	prompt: string;
	failureIndicators: string[];
	passIndicators: string[];
	modalities?: ("text" | "image" | "voice" | "document")[];
	requiresDataset?: boolean;
}

export interface RegistryLoadResult {
	success: boolean;
	probes: AIProbe[];
	errors: string[];
	loadedFrom?: string;
}

const VALID_CATEGORIES: ProbeCategory[] = [
	"security",
	"safety",
	"trustworthiness",
	"business-alignment",
];

const VALID_SEVERITIES: ProbeSeverity[] = ["critical", "high", "medium", "low", "informational"];

const VALID_MODALITIES = ["text", "image", "voice", "document"] as const;

function validateProbe(def: unknown, index: number): { probe?: AIProbe; error?: string } {
	if (typeof def !== "object" || def === null) {
		return { error: `Probe ${index}: not an object` };
	}
	const d = def as Record<string, unknown>;

	const required = [
		"id",
		"title",
		"category",
		"severity",
		"description",
		"prompt",
		"failureIndicators",
		"passIndicators",
	];
	for (const key of required) {
		if (d[key] === undefined) {
			return { error: `Probe ${index}: missing required field "${key}"` };
		}
	}

	if (typeof d.id !== "string" || d.id.length === 0) {
		return { error: `Probe ${index}: "id" must be a non-empty string` };
	}
	if (typeof d.title !== "string" || d.title.length === 0) {
		return { error: `Probe ${index}: "title" must be a non-empty string` };
	}
	if (!VALID_CATEGORIES.includes(d.category as ProbeCategory)) {
		return { error: `Probe ${index}: "category" must be one of ${VALID_CATEGORIES.join(", ")}` };
	}
	if (!VALID_SEVERITIES.includes(d.severity as ProbeSeverity)) {
		return { error: `Probe ${index}: "severity" must be one of ${VALID_SEVERITIES.join(", ")}` };
	}
	if (typeof d.description !== "string") {
		return { error: `Probe ${index}: "description" must be a string` };
	}
	if (typeof d.prompt !== "string" || d.prompt.length === 0) {
		return { error: `Probe ${index}: "prompt" must be a non-empty string` };
	}
	if (
		!Array.isArray(d.failureIndicators) ||
		!d.failureIndicators.every((i: unknown) => typeof i === "string")
	) {
		return { error: `Probe ${index}: "failureIndicators" must be an array of strings` };
	}
	if (
		!Array.isArray(d.passIndicators) ||
		!d.passIndicators.every((i: unknown) => typeof i === "string")
	) {
		return { error: `Probe ${index}: "passIndicators" must be an array of strings` };
	}

	const modalities: ("text" | "image" | "voice" | "document")[] = ["text"];
	if (d.modalities !== undefined) {
		if (!Array.isArray(d.modalities)) {
			return { error: `Probe ${index}: "modalities" must be an array` };
		}
		for (const m of d.modalities) {
			if (!VALID_MODALITIES.includes(m as (typeof VALID_MODALITIES)[number])) {
				return { error: `Probe ${index}: invalid modality "${m}"` };
			}
		}
		modalities.push(
			...(d.modalities as (typeof VALID_MODALITIES)[number][]).filter((m) => m !== "text")
		);
	}

	const probe: AIProbe = {
		id: d.id,
		title: d.title,
		category: d.category as ProbeCategory,
		severity: d.severity as ProbeSeverity,
		description: d.description,
		prompt: d.prompt,
		failureIndicators: d.failureIndicators as string[],
		passIndicators: d.passIndicators as string[],
		modalities: modalities.length > 0 ? [...new Set(modalities)] : ["text"],
		requiresDataset: d.requiresDataset === true,
	};

	return { probe };
}

/**
 * Load probes from a JSON string or array of probe definitions.
 */
export function loadProbesFromJSON(json: string | CustomProbeDefinition[]): RegistryLoadResult {
	let defs: unknown[];
	try {
		defs = Array.isArray(json) ? json : (JSON.parse(json) as unknown[]);
	} catch (e) {
		return {
			success: false,
			probes: [],
			errors: [`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`],
		};
	}

	if (!Array.isArray(defs)) {
		return { success: false, probes: [], errors: ["JSON must be an array of probe definitions"] };
	}

	const probes: AIProbe[] = [];
	const errors: string[] = [];
	for (let i = 0; i < defs.length; i++) {
		const { probe, error } = validateProbe(defs[i], i);
		if (error) errors.push(error);
		else if (probe) probes.push(probe);
	}

	return { success: errors.length === 0, probes, errors };
}

/**
 * Simple YAML parser for probe arrays (supports --- documents and basic key:value).
 * This is intentionally lightweight — no full YAML spec compliance needed.
 * Handles arrays via `key:` followed by indented `- value` lines, or inline `["a","b"]`.
 * Handles multi-line strings via `key: |` followed by indented lines.
 */
function parseSimpleYAML(text: string): unknown[] {
	const lines = text.split("\n");
	const docs: unknown[] = [];
	let currentDoc: Record<string, unknown> | null = null;
	let arrayStack: { key: string; indent: number; values: string[] } | null = null;
	let literalStack: { key: string; indent: number; lines: string[] } | null = null;

	function flushArray() {
		if (arrayStack && currentDoc) {
			currentDoc[arrayStack.key] = arrayStack.values;
			arrayStack = null;
		}
	}

	function flushLiteral() {
		if (literalStack && currentDoc) {
			currentDoc[literalStack.key] = literalStack.lines.join("\n");
			literalStack = null;
		}
	}

	for (const rawLine of lines) {
		const line = rawLine.replace(/\r$/, "");
		if (line.trim() === "---" || line.trim() === "...") {
			flushArray();
			flushLiteral();
			if (currentDoc) {
				docs.push(currentDoc);
				currentDoc = null;
			}
			continue;
		}
		if (line.trim().startsWith("#") || line.trim().length === 0) continue;

		const indent = line.search(/\S/);
		if (indent === -1) continue;

		const trimmed = line.trim();

		// Array item
		if (trimmed.startsWith("- ")) {
			const value = trimmed.slice(2).trim();
			if (arrayStack) {
				arrayStack.values.push(parseYAMLValue(value) as string);
			}
			continue;
		}

		// Literal block line (indented content under key: |)
		if (literalStack && indent > literalStack.indent) {
			literalStack.lines.push(line.slice(literalStack.indent + 2));
			continue;
		}
		if (literalStack && indent <= literalStack.indent) {
			flushLiteral();
		}

		// Array continuation line (indented content under key:)
		if (arrayStack && indent > arrayStack.indent && !trimmed.includes(":")) {
			// This is a continuation of an array value that wasn't marked with -
			continue;
		}
		if (arrayStack && indent <= arrayStack.indent) {
			flushArray();
		}

		// Key: value
		const colonIdx = trimmed.indexOf(":");
		if (colonIdx > 0) {
			const key = trimmed.slice(0, colonIdx).trim();
			const value = trimmed.slice(colonIdx + 1).trim();

			if (!currentDoc) currentDoc = {};

			if (value === "|") {
				// Start literal block
				literalStack = { key, indent, lines: [] };
			} else if (value.length === 0) {
				// Start of an array block
				arrayStack = { key, indent, values: [] };
			} else {
				currentDoc[key] = parseYAMLValue(value);
			}
		}
	}

	flushArray();
	flushLiteral();
	if (currentDoc) {
		docs.push(currentDoc);
	}

	return docs;
}

function parseYAMLValue(v: string): unknown {
	if (v === "true" || v === "yes" || v === "on") return true;
	if (v === "false" || v === "no" || v === "off") return false;
	if (v === "null" || v === "~") return null;
	if (/^\d+$/.test(v)) return Number.parseInt(v, 10);
	if (/^\d+\.\d+$/.test(v)) return Number.parseFloat(v);
	if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
		return v.slice(1, -1);
	}
	if (v.startsWith("[") && v.endsWith("]")) {
		try {
			return JSON.parse(v);
		} catch {
			return v;
		}
	}
	return v;
}

/**
 * Load probes from a YAML string.
 */
export function loadProbesFromYAML(yaml: string): RegistryLoadResult {
	let docs: unknown[];
	try {
		docs = parseSimpleYAML(yaml);
	} catch (e) {
		return {
			success: false,
			probes: [],
			errors: [`YAML parse error: ${e instanceof Error ? e.message : String(e)}`],
		};
	}

	const probes: AIProbe[] = [];
	const errors: string[] = [];
	for (let i = 0; i < docs.length; i++) {
		const { probe, error } = validateProbe(docs[i], i);
		if (error) errors.push(error);
		else if (probe) probes.push(probe);
	}

	return { success: errors.length === 0, probes, errors };
}

/**
 * Build a unified probe array from built-ins plus custom probes.
 * Custom probes override built-ins when IDs collide.
 */
export function buildUnifiedProbeList(builtIns: AIProbe[], custom: AIProbe[]): AIProbe[] {
	const byId = new Map<string, AIProbe>();
	for (const p of builtIns) byId.set(p.id, p);
	for (const p of custom) byId.set(p.id, p); // custom overrides
	return Array.from(byId.values());
}

/**
 * Serialize a probe definition to JSON.
 */
export function serializeProbeToJSON(probe: AIProbe): string {
	return JSON.stringify(
		{
			id: probe.id,
			title: probe.title,
			category: probe.category,
			severity: probe.severity,
			description: probe.description,
			prompt: probe.prompt,
			failureIndicators: probe.failureIndicators,
			passIndicators: probe.passIndicators,
			modalities: probe.modalities,
			requiresDataset: probe.requiresDataset,
		},
		null,
		2
	);
}

/**
 * Serialize probes to a simple YAML string.
 */
export function serializeProbesToYAML(probes: AIProbe[]): string {
	const lines: string[] = [];
	for (const p of probes) {
		lines.push("---");
		lines.push(`id: ${p.id}`);
		lines.push(`title: "${p.title.replace(/"/g, '\\"')}"`);
		lines.push(`category: ${p.category}`);
		lines.push(`severity: ${p.severity}`);
		lines.push(`description: "${p.description.replace(/"/g, '\\"')}"`);
		lines.push(`prompt: |`);
		for (const line of p.prompt.split("\n")) {
			lines.push(`  ${line}`);
		}
		lines.push("failureIndicators:");
		for (const fi of p.failureIndicators) {
			lines.push(`  - "${fi.replace(/"/g, '\\"')}"`);
		}
		lines.push("passIndicators:");
		for (const pi of p.passIndicators) {
			lines.push(`  - "${pi.replace(/"/g, '\\"')}"`);
		}
		lines.push(`modalities: [${p.modalities.map((m) => `"${m}"`).join(", ")}]`);
		lines.push(`requiresDataset: ${p.requiresDataset}`);
	}
	return lines.join("\n");
}
