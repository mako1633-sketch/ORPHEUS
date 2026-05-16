/**
 * Self-Reflection & Learning Loop
 * After every non-trivial task, ORPHEUS writes a short retrospective
 * to persistent state. Over time this builds a per-project playbook.
 * Next time a similar error or task type is encountered, the reflection
 * is injected into the prompt context.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { debug } from "../utils/debug-logger";
import { getAppConfigDir } from "../utils/preferences";
import { loadState, persistState } from "./crash-resistant-state";
import { appendPersistentContext } from "./persistent-context";

const REFLECTION_FILE = "reflections.json";
const MAX_REFLECTIONS = 60;
const MAX_CHARS = 3000;

export interface ReflectionEntry {
	id: string;
	project?: string;
	taskType: "coding" | "debug" | "setup" | "security" | "general";
	goal: string;
	whatWorked: string[];
	whatFailed: string[];
	validationThatCaught: string[];
	validationThatMissed: string[];
	keyAssumptions: string[];
	risksSurfaced: string[];
	createdAt: string;
}

export interface ReflectionState {
	updatedAt: string;
	entries: ReflectionEntry[];
}

function getReflectionPath(): string {
	return path.join(getAppConfigDir(), REFLECTION_FILE);
}

function makeId(): string {
	return `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanList(values?: string[]): string[] {
	return [...new Set((values ?? []).map((v) => v.trim()).filter(Boolean))].slice(-12);
}

function cleanText(value: string): string {
	const trimmed = redactSensitiveText(value.trim());
	return trimmed.length > MAX_CHARS ? trimmed.slice(0, MAX_CHARS).trim() : trimmed;
}

function redactSensitiveText(value: string): string {
	return value
		.replace(/\b(sk-[A-Za-z0-9_-]{10,})\b/g, "[redacted-token]")
		.replace(
			/\b(api[_-]?key|token|password|secret)\s*[:=]\s*("[^"]+"|'[^']+'|[^\s,;]+)/gi,
			"$1=[redacted]"
		);
}

function buildLongTermLearning(entry: ReflectionEntry): string {
	const lessonParts = [
		entry.whatWorked.length ? `Reuse: ${entry.whatWorked.join("; ")}.` : "",
		entry.whatFailed.length ? `Watch for: ${entry.whatFailed.join("; ")}.` : "",
		entry.validationThatCaught.length
			? `Validation that caught issues: ${entry.validationThatCaught.join("; ")}.`
			: "",
		entry.validationThatMissed.length
			? `Validation gaps: ${entry.validationThatMissed.join("; ")}.`
			: "",
		entry.keyAssumptions.length
			? `Assumptions to recheck: ${entry.keyAssumptions.join("; ")}.`
			: "",
		entry.risksSurfaced.length ? `Risks surfaced: ${entry.risksSurfaced.join("; ")}.` : "",
	].filter(Boolean);

	const project = entry.project ? ` for ${entry.project}` : "";
	const body =
		lessonParts.length > 0
			? lessonParts.join(" ")
			: "Retrospective recorded without specific reusable lessons.";
	return cleanText(`ORPHEUS learned from ${entry.taskType} task${project}: ${entry.goal}. ${body}`);
}

export async function loadReflections(): Promise<ReflectionState> {
	const state = await loadState<ReflectionState>(getReflectionPath());
	if (!state) return { updatedAt: new Date().toISOString(), entries: [] };
	return {
		updatedAt: state.updatedAt ?? new Date().toISOString(),
		entries: Array.isArray(state.entries) ? state.entries.slice(-MAX_REFLECTIONS) : [],
	};
}

export async function saveReflections(
	state: ReflectionState
): Promise<{ path: string; success: boolean }> {
	return persistState(getReflectionPath(), {
		updatedAt: new Date().toISOString(),
		entries: state.entries.slice(-MAX_REFLECTIONS),
	});
}

export async function addReflection(input: {
	project?: string;
	taskType: ReflectionEntry["taskType"];
	goal: string;
	whatWorked?: string[];
	whatFailed?: string[];
	validationThatCaught?: string[];
	validationThatMissed?: string[];
	keyAssumptions?: string[];
	risksSurfaced?: string[];
}): Promise<{ path: string; entry: ReflectionEntry; success: boolean }> {
	const state = await loadReflections();
	const entry: ReflectionEntry = {
		id: makeId(),
		project: input.project ? cleanText(input.project) : undefined,
		taskType: input.taskType,
		goal: cleanText(input.goal),
		whatWorked: cleanList(input.whatWorked),
		whatFailed: cleanList(input.whatFailed),
		validationThatCaught: cleanList(input.validationThatCaught),
		validationThatMissed: cleanList(input.validationThatMissed),
		keyAssumptions: cleanList(input.keyAssumptions),
		risksSurfaced: cleanList(input.risksSurfaced),
		createdAt: new Date().toISOString(),
	};
	const next = { updatedAt: entry.createdAt, entries: [...state.entries, entry] };
	const result = await saveReflections(next);
	try {
		await appendPersistentContext(buildLongTermLearning(entry));
	} catch (error) {
		debug.error("reflection-learning-memory", {
			message: "Failed to write reflection lesson to persistent context",
			error: error instanceof Error ? error.message : String(error),
		});
	}
	return { ...result, entry };
}

/** Search reflections by task type and optional project, newest first */
export async function searchReflections(query: {
	taskType?: ReflectionEntry["taskType"];
	project?: string;
	limit?: number;
}): Promise<ReflectionEntry[]> {
	const state = await loadReflections();
	const limit = Math.max(1, Math.min(query.limit ?? 5, MAX_REFLECTIONS));
	return state.entries
		.filter((e) => !query.taskType || e.taskType === query.taskType)
		.filter(
			(e) => !query.project || (e.project ?? "").toLowerCase().includes(query.project.toLowerCase())
		)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.slice(0, limit);
}

/** Build prompt injection from relevant past reflections */
export async function buildReflectionContext(
	taskType: ReflectionEntry["taskType"],
	project?: string,
	limit = 3
): Promise<string> {
	const entries = await searchReflections({ taskType, project, limit });
	if (entries.length === 0) return "";

	const lines = entries.map((e, i) => {
		const parts = [
			`${i + 1}. ${e.goal} (${e.createdAt.slice(0, 10)})`,
			e.whatWorked.length ? `   Worked: ${e.whatWorked.join("; ")}` : "",
			e.whatFailed.length ? `   Failed: ${e.whatFailed.join("; ")}` : "",
			e.validationThatCaught.length ? `   Caught by: ${e.validationThatCaught.join("; ")}` : "",
			e.keyAssumptions.length ? `   Assumptions: ${e.keyAssumptions.join("; ")}` : "",
		].filter(Boolean);
		return parts.join("\n");
	});

	return `<past-reflections>
Lessons from previous ${taskType} tasks${project ? ` on "${project}"` : ""}:

${lines.join("\n\n")}

Apply these lessons to avoid repeat mistakes and reuse effective validation paths.
</past-reflections>`;
}
