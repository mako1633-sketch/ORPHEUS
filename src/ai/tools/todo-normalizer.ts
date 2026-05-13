import type { TodoStatus } from "../../types";

export interface NormalizedTodoItem {
	content: string;
	status?: TodoStatus;
}

type UnknownRecord = Record<string, unknown>;

const STATUS_ALIASES: Record<string, TodoStatus> = {
	pending: "pending",
	todo: "pending",
	open: "pending",
	queued: "pending",
	"not-started": "pending",
	not_started: "pending",
	in_progress: "in_progress",
	"in-progress": "in_progress",
	"in progress": "in_progress",
	active: "in_progress",
	current: "in_progress",
	doing: "in_progress",
	started: "in_progress",
	completed: "completed",
	complete: "completed",
	done: "completed",
	finished: "completed",
	resolved: "completed",
	cancelled: "cancelled",
	canceled: "cancelled",
	cancel: "cancelled",
	skipped: "cancelled",
	abandoned: "cancelled",
};

const ACTION_ALIASES: Record<string, "write" | "update" | "list"> = {
	write: "write",
	set: "write",
	replace: "write",
	create: "write",
	save: "write",
	update: "update",
	edit: "update",
	change: "update",
	list: "list",
	read: "list",
	show: "list",
	get: "list",
};

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeKey(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseJsonish(value: string): unknown {
	const trimmed = value.trim();
	const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	const candidate = fenced ? fenced[1]!.trim() : trimmed;

	try {
		return JSON.parse(candidate);
	} catch {
		return value;
	}
}

export function normalizeTodoStatus(value: unknown): TodoStatus | undefined {
	if (typeof value !== "string") return undefined;
	return STATUS_ALIASES[normalizeKey(value)];
}

export function normalizeTodoAction(value: unknown): "write" | "update" | "list" | undefined {
	if (typeof value !== "string") return undefined;
	return ACTION_ALIASES[normalizeKey(value)];
}

export function normalizeTodoIndex(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
	if (typeof value !== "string") return undefined;

	const parsed = Number(value.trim());
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function getTodoContent(record: UnknownRecord): string | undefined {
	for (const key of ["content", "task", "title", "text", "description", "name"]) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

function normalizeTodoRecord(record: UnknownRecord): NormalizedTodoItem | null {
	const content = getTodoContent(record);
	if (!content) return null;

	return {
		content,
		status: normalizeTodoStatus(record.status) ?? "pending",
	};
}

function getWrappedTodos(value: UnknownRecord): unknown {
	for (const key of ["todos", "items", "tasks", "list", "todo"]) {
		if (key in value) return value[key];
	}
	return value;
}

export function normalizeTodoItems(value: unknown): NormalizedTodoItem[] | null {
	const parsed = typeof value === "string" ? parseJsonish(value) : value;
	const unwrapped = isRecord(parsed) ? getWrappedTodos(parsed) : parsed;

	if (Array.isArray(unwrapped)) {
		const todos = unwrapped
			.map((item): NormalizedTodoItem | null => {
				if (typeof item === "string" && item.trim()) {
					return { content: item.trim(), status: "pending" };
				}
				if (isRecord(item)) {
					return normalizeTodoRecord(item);
				}
				return null;
			})
			.filter((item): item is NormalizedTodoItem => item !== null);

		return todos.length > 0 || unwrapped.length === 0 ? todos : null;
	}

	if (isRecord(unwrapped)) {
		const todo = normalizeTodoRecord(unwrapped);
		return todo ? [todo] : null;
	}

	return null;
}
