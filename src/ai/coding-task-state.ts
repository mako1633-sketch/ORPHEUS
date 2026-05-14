import { promises as fs } from "node:fs";
import path from "node:path";
import { getAppConfigDir } from "../utils/preferences";

const CODING_TASK_STATE_FILE = "coding-task-state.json";
const MAX_ENTRIES = 24;
const MAX_TEXT_CHARS = 4000;

export type CodingTaskStatus = "planned" | "in_progress" | "blocked" | "completed";

export interface CodingTaskState {
	goal: string;
	status: CodingTaskStatus;
	updatedAt: string;
	filesInspected: string[];
	filesChanged: string[];
	checksRun: string[];
	failures: string[];
	evidence: string[];
	assumptions: string[];
	risks: string[];
	nextStep?: string;
}

export function getCodingTaskStatePath(): string {
	return path.join(getAppConfigDir(), CODING_TASK_STATE_FILE);
}

function cleanText(value: string): string {
	const normalized = value.trim();
	return normalized.length > MAX_TEXT_CHARS ? normalized.slice(0, MAX_TEXT_CHARS).trim() : normalized;
}

function cleanList(values?: string[]): string[] {
	return [...new Set((values ?? []).map((value) => cleanText(value)).filter(Boolean))].slice(-MAX_ENTRIES);
}

export async function loadCodingTaskState(): Promise<CodingTaskState | null> {
	try {
		const raw = await fs.readFile(getCodingTaskStatePath(), "utf8");
		const parsed = JSON.parse(raw) as Partial<CodingTaskState>;
		if (!parsed.goal || typeof parsed.goal !== "string") return null;

		return {
			goal: cleanText(parsed.goal),
			status: parsed.status ?? "in_progress",
			updatedAt: parsed.updatedAt ?? new Date().toISOString(),
			filesInspected: cleanList(parsed.filesInspected),
			filesChanged: cleanList(parsed.filesChanged),
			checksRun: cleanList(parsed.checksRun),
			failures: cleanList(parsed.failures),
			evidence: cleanList(parsed.evidence),
			assumptions: cleanList(parsed.assumptions),
			risks: cleanList(parsed.risks),
			nextStep: parsed.nextStep ? cleanText(parsed.nextStep) : undefined,
		};
	} catch {
		return null;
	}
}

export async function saveCodingTaskState(input: {
	goal: string;
	status?: CodingTaskStatus;
	filesInspected?: string[];
	filesChanged?: string[];
	checksRun?: string[];
	failures?: string[];
	evidence?: string[];
	assumptions?: string[];
	risks?: string[];
	nextStep?: string;
}): Promise<{ path: string; state: CodingTaskState }> {
	const state: CodingTaskState = {
		goal: cleanText(input.goal),
		status: input.status ?? "in_progress",
		updatedAt: new Date().toISOString(),
		filesInspected: cleanList(input.filesInspected),
		filesChanged: cleanList(input.filesChanged),
		checksRun: cleanList(input.checksRun),
		failures: cleanList(input.failures),
		evidence: cleanList(input.evidence),
		assumptions: cleanList(input.assumptions),
		risks: cleanList(input.risks),
		nextStep: input.nextStep ? cleanText(input.nextStep) : undefined,
	};

	const statePath = getCodingTaskStatePath();
	await fs.mkdir(path.dirname(statePath), { recursive: true });
	await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	return { path: statePath, state };
}

export async function updateCodingTaskState(input: Partial<Omit<CodingTaskState, "updatedAt">>): Promise<{
	path: string;
	state: CodingTaskState;
}> {
	const existing = await loadCodingTaskState();
	const goal = input.goal ?? existing?.goal ?? "Coding task";
	return saveCodingTaskState({
		goal,
		status: input.status ?? existing?.status ?? "in_progress",
		filesInspected: cleanList([...(existing?.filesInspected ?? []), ...(input.filesInspected ?? [])]),
		filesChanged: cleanList([...(existing?.filesChanged ?? []), ...(input.filesChanged ?? [])]),
		checksRun: cleanList([...(existing?.checksRun ?? []), ...(input.checksRun ?? [])]),
		failures: cleanList([...(existing?.failures ?? []), ...(input.failures ?? [])]),
		evidence: cleanList([...(existing?.evidence ?? []), ...(input.evidence ?? [])]),
		assumptions: cleanList([...(existing?.assumptions ?? []), ...(input.assumptions ?? [])]),
		risks: cleanList([...(existing?.risks ?? []), ...(input.risks ?? [])]),
		nextStep: input.nextStep ?? existing?.nextStep,
	});
}

export async function clearCodingTaskState(): Promise<{ path: string; cleared: boolean }> {
	const statePath = getCodingTaskStatePath();
	await fs.rm(statePath, { force: true });
	return { path: statePath, cleared: true };
}
