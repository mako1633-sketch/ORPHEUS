import { promises as fs } from "node:fs";
import path from "node:path";
import { getAppConfigDir } from "../utils/preferences";

const TASK_STACK_FILE = "task-stack.json";
const MAX_TASKS = 120;
const MAX_TEXT_CHARS = 2000;

export type TaskStackStatus = "queued" | "active" | "blocked" | "done" | "archived";
export type TaskStackPriority = "low" | "normal" | "high" | "urgent";

export interface TaskStackItem {
	id: string;
	title: string;
	status: TaskStackStatus;
	priority: TaskStackPriority;
	createdAt: string;
	updatedAt: string;
	context?: string;
	nextStep?: string;
	owner?: string;
	dueAt?: string;
	source?: string;
}

export interface TaskStackState {
	updatedAt: string;
	items: TaskStackItem[];
}

export function getTaskStackPath(): string {
	return path.join(getAppConfigDir(), TASK_STACK_FILE);
}

function nowIso(): string {
	return new Date().toISOString();
}

function cleanText(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	return trimmed.length > MAX_TEXT_CHARS ? trimmed.slice(0, MAX_TEXT_CHARS).trim() : trimmed;
}

function makeId(): string {
	return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeStatus(value: string | undefined): TaskStackStatus {
	if (value === "active" || value === "blocked" || value === "done" || value === "archived") return value;
	return "queued";
}

function normalizePriority(value: string | undefined): TaskStackPriority {
	if (value === "low" || value === "high" || value === "urgent") return value;
	return "normal";
}

function sortTasks(items: TaskStackItem[]): TaskStackItem[] {
	const statusRank: Record<TaskStackStatus, number> = {
		active: 0,
		blocked: 1,
		queued: 2,
		done: 3,
		archived: 4,
	};
	const priorityRank: Record<TaskStackPriority, number> = {
		urgent: 0,
		high: 1,
		normal: 2,
		low: 3,
	};
	return [...items].sort((a, b) => {
		const status = statusRank[a.status] - statusRank[b.status];
		if (status !== 0) return status;
		const priority = priorityRank[a.priority] - priorityRank[b.priority];
		if (priority !== 0) return priority;
		return a.createdAt.localeCompare(b.createdAt);
	});
}

export async function loadTaskStack(): Promise<TaskStackState> {
	try {
		const raw = await fs.readFile(getTaskStackPath(), "utf8");
		const parsed = JSON.parse(raw) as Partial<TaskStackState>;
		const items = Array.isArray(parsed.items)
			? parsed.items
					.filter((item): item is TaskStackItem => {
						return Boolean(item && typeof item.id === "string" && typeof item.title === "string");
					})
					.map((item) => ({
						...item,
						status: normalizeStatus(item.status),
						priority: normalizePriority(item.priority),
						createdAt: item.createdAt ?? nowIso(),
						updatedAt: item.updatedAt ?? nowIso(),
					}))
					.slice(-MAX_TASKS)
			: [];
		return {
			updatedAt: parsed.updatedAt ?? nowIso(),
			items: sortTasks(items),
		};
	} catch {
		return { updatedAt: nowIso(), items: [] };
	}
}

async function saveTaskStack(items: TaskStackItem[]): Promise<{ path: string; state: TaskStackState }> {
	const state = {
		updatedAt: nowIso(),
		items: sortTasks(items).slice(0, MAX_TASKS),
	};
	const stackPath = getTaskStackPath();
	await fs.mkdir(path.dirname(stackPath), { recursive: true });
	await fs.writeFile(stackPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	return { path: stackPath, state };
}

export async function pushTaskStackItem(input: {
	title: string;
	priority?: TaskStackPriority;
	context?: string;
	nextStep?: string;
	owner?: string;
	dueAt?: string;
	source?: string;
}): Promise<{ path: string; item: TaskStackItem; state: TaskStackState }> {
	const state = await loadTaskStack();
	const timestamp = nowIso();
	const item: TaskStackItem = {
		id: makeId(),
		title: cleanText(input.title) ?? "Untitled task",
		status: "queued",
		priority: normalizePriority(input.priority),
		createdAt: timestamp,
		updatedAt: timestamp,
		context: cleanText(input.context),
		nextStep: cleanText(input.nextStep),
		owner: cleanText(input.owner),
		dueAt: cleanText(input.dueAt),
		source: cleanText(input.source),
	};
	const saved = await saveTaskStack([...state.items, item]);
	return { ...saved, item };
}

export async function updateTaskStackItem(input: {
	id: string;
	status?: TaskStackStatus;
	priority?: TaskStackPriority;
	title?: string;
	context?: string;
	nextStep?: string;
	owner?: string;
	dueAt?: string;
}): Promise<{ path: string; item?: TaskStackItem; state: TaskStackState; found: boolean }> {
	const state = await loadTaskStack();
	let updated: TaskStackItem | undefined;
	const items = state.items.map((item) => {
		if (item.id !== input.id) return item;
		updated = {
			...item,
			status: input.status ?? item.status,
			priority: input.priority ?? item.priority,
			title: cleanText(input.title) ?? item.title,
			context: input.context === undefined ? item.context : cleanText(input.context),
			nextStep: input.nextStep === undefined ? item.nextStep : cleanText(input.nextStep),
			owner: input.owner === undefined ? item.owner : cleanText(input.owner),
			dueAt: input.dueAt === undefined ? item.dueAt : cleanText(input.dueAt),
			updatedAt: nowIso(),
		};
		return updated;
	});
	const saved = await saveTaskStack(items);
	return { ...saved, item: updated, found: Boolean(updated) };
}

export async function popNextTaskStackItem(): Promise<{
	path: string;
	item?: TaskStackItem;
	state: TaskStackState;
}> {
	const state = await loadTaskStack();
	const next = sortTasks(state.items).find((item) => item.status === "queued" || item.status === "blocked");
	if (!next) {
		const saved = await saveTaskStack(state.items);
		return { ...saved, item: undefined };
	}
	return updateTaskStackItem({ id: next.id, status: "active" });
}

export async function listTaskStackItems(
	input: {
		status?: TaskStackStatus;
		limit?: number;
	} = {}
): Promise<TaskStackItem[]> {
	const state = await loadTaskStack();
	const limit = Math.max(1, Math.min(input.limit ?? 30, MAX_TASKS));
	return sortTasks(state.items)
		.filter((item) => !input.status || item.status === input.status)
		.slice(0, limit);
}
