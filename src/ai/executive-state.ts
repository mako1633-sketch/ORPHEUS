import path from "node:path";
import { getAppConfigDir } from "../utils/preferences";
import { atomicWriteFile, safeReadFile } from "./crash-resistant-state";

const EXECUTIVE_STATE_FILE = "executive-state.json";
const MAX_ITEMS = 80;
const MAX_TEXT_CHARS = 2000;

export type ExecutiveItemKind =
	| "priority"
	| "follow_up"
	| "decision"
	| "waiting_on"
	| "risk"
	| "note";
export type ExecutiveItemStatus = "open" | "done" | "blocked" | "archived";

export interface ExecutiveItem {
	id: string;
	kind: ExecutiveItemKind;
	title: string;
	status: ExecutiveItemStatus;
	createdAt: string;
	updatedAt: string;
	dueAt?: string;
	owner?: string;
	context?: string;
	source?: string;
}

export interface ExecutiveState {
	updatedAt: string;
	items: ExecutiveItem[];
}

export function getExecutiveStatePath(): string {
	return path.join(getAppConfigDir(), EXECUTIVE_STATE_FILE);
}

function nowIso(): string {
	return new Date().toISOString();
}

function makeId(kind: ExecutiveItemKind): string {
	return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanText(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	return trimmed.length > MAX_TEXT_CHARS ? trimmed.slice(0, MAX_TEXT_CHARS).trim() : trimmed;
}

function normalizeItem(
	input: Partial<ExecutiveItem> & { kind: ExecutiveItemKind; title: string }
): ExecutiveItem {
	const timestamp = nowIso();
	return {
		id: input.id ?? makeId(input.kind),
		kind: input.kind,
		title: cleanText(input.title) ?? "Untitled",
		status: input.status ?? "open",
		createdAt: input.createdAt ?? timestamp,
		updatedAt: timestamp,
		dueAt: cleanText(input.dueAt),
		owner: cleanText(input.owner),
		context: cleanText(input.context),
		source: cleanText(input.source),
	};
}

export async function loadExecutiveState(): Promise<ExecutiveState> {
	const raw = await safeReadFile(getExecutiveStatePath());
	if (!raw) return { updatedAt: nowIso(), items: [] };
	try {
		const parsed = JSON.parse(raw) as Partial<ExecutiveState>;
		const items = Array.isArray(parsed.items)
			? parsed.items
					.filter((item): item is ExecutiveItem => {
						return Boolean(
							item &&
								typeof item.id === "string" &&
								typeof item.title === "string" &&
								typeof item.kind === "string"
						);
					})
					.slice(-MAX_ITEMS)
			: [];

		return {
			updatedAt: parsed.updatedAt ?? nowIso(),
			items,
		};
	} catch {
		return { updatedAt: nowIso(), items: [] };
	}
}

async function saveExecutiveState(
	state: ExecutiveState
): Promise<{ path: string; state: ExecutiveState }> {
	const statePath = getExecutiveStatePath();
	const next = {
		updatedAt: nowIso(),
		items: state.items.slice(-MAX_ITEMS),
	};
	await atomicWriteFile(statePath, `${JSON.stringify(next, null, 2)}\n`);
	return { path: statePath, state: next };
}

export async function addExecutiveItem(input: {
	kind: ExecutiveItemKind;
	title: string;
	dueAt?: string;
	owner?: string;
	context?: string;
	source?: string;
	status?: ExecutiveItemStatus;
}): Promise<{ path: string; item: ExecutiveItem; state: ExecutiveState }> {
	const state = await loadExecutiveState();
	const item = normalizeItem(input);
	const saved = await saveExecutiveState({ updatedAt: nowIso(), items: [...state.items, item] });
	return { ...saved, item };
}

export async function updateExecutiveItem(input: {
	id: string;
	status?: ExecutiveItemStatus;
	title?: string;
	dueAt?: string;
	owner?: string;
	context?: string;
}): Promise<{ path: string; item?: ExecutiveItem; state: ExecutiveState; found: boolean }> {
	const state = await loadExecutiveState();
	let updated: ExecutiveItem | undefined;
	const items = state.items.map((item) => {
		if (item.id !== input.id) return item;
		updated = {
			...item,
			status: input.status ?? item.status,
			title: cleanText(input.title) ?? item.title,
			dueAt: input.dueAt === undefined ? item.dueAt : cleanText(input.dueAt),
			owner: input.owner === undefined ? item.owner : cleanText(input.owner),
			context: input.context === undefined ? item.context : cleanText(input.context),
			updatedAt: nowIso(),
		};
		return updated;
	});

	const saved = await saveExecutiveState({ updatedAt: nowIso(), items });
	return { ...saved, item: updated, found: Boolean(updated) };
}

export async function listExecutiveItems(
	input: {
		kind?: ExecutiveItemKind;
		status?: ExecutiveItemStatus;
		limit?: number;
	} = {}
): Promise<ExecutiveItem[]> {
	const state = await loadExecutiveState();
	const limit = Math.max(1, Math.min(input.limit ?? 20, MAX_ITEMS));
	return state.items
		.filter((item) => !input.kind || item.kind === input.kind)
		.filter((item) => !input.status || item.status === input.status)
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
		.slice(0, limit);
}

export async function buildExecutiveBriefing(): Promise<{
	updatedAt: string;
	counts: Record<ExecutiveItemKind, number>;
	open: ExecutiveItem[];
	overdue: ExecutiveItem[];
	upcoming: ExecutiveItem[];
	decisions: ExecutiveItem[];
	risks: ExecutiveItem[];
}> {
	const state = await loadExecutiveState();
	const open = state.items.filter((item) => item.status === "open" || item.status === "blocked");
	const now = Date.now();
	const soon = now + 7 * 24 * 60 * 60 * 1000;
	const dated = open.filter((item) => item.dueAt && !Number.isNaN(Date.parse(item.dueAt)));
	const overdue = dated.filter((item) => Date.parse(item.dueAt as string) < now);
	const upcoming = dated.filter((item) => {
		const due = Date.parse(item.dueAt as string);
		return due >= now && due <= soon;
	});

	return {
		updatedAt: state.updatedAt,
		counts: {
			priority: open.filter((item) => item.kind === "priority").length,
			follow_up: open.filter((item) => item.kind === "follow_up").length,
			decision: open.filter((item) => item.kind === "decision").length,
			waiting_on: open.filter((item) => item.kind === "waiting_on").length,
			risk: open.filter((item) => item.kind === "risk").length,
			note: open.filter((item) => item.kind === "note").length,
		},
		open: open.slice(-20).reverse(),
		overdue,
		upcoming,
		decisions: open
			.filter((item) => item.kind === "decision")
			.slice(-10)
			.reverse(),
		risks: open
			.filter((item) => item.kind === "risk")
			.slice(-10)
			.reverse(),
	};
}
