import { tool } from "ai";
import { z } from "zod";
import { getRuntimeContext } from "../../state/runtime-context";
import { loadLatestTodoList, saveTodoList } from "../../state/session-store";
import type { TodoItem } from "../../types";
import {
	normalizeTodoAction,
	normalizeTodoIndex,
	normalizeTodoItems,
	normalizeTodoStatus,
} from "./todo-normalizer";

let currentTodos: TodoItem[] = [];
let lastSessionId: string | null = null;

function formatTodoList(todos: TodoItem[]): string {
	if (todos.length === 0) {
		return "No todos.";
	}

	const statusIcon: Record<TodoItem["status"], string> = {
		pending: "[pending]",
		in_progress: "[in_progress]",
		completed: "[completed]",
		cancelled: "[cancelled]",
	};

	const lines = todos.map((todo, index) => {
		return `${index + 1}. ${statusIcon[todo.status]} ${todo.content}`;
	});

	return lines.join("\n");
}

async function ensureTodosLoaded(sessionId: string | null): Promise<void> {
	if (sessionId === lastSessionId) return;

	lastSessionId = sessionId;
	if (sessionId) {
		currentTodos = await loadLatestTodoList(sessionId);
	} else {
		currentTodos = [];
	}
}

const todoItemSchema = z.object({
	content: z.string().describe("The todo item description"),
	status: z
		.enum(["pending", "in_progress", "completed", "cancelled"])
		.default("pending")
		.describe("Status of the todo"),
});

function preprocessTodoAction(value: unknown): unknown {
	return normalizeTodoAction(value) ?? value;
}

function preprocessTodoItems(value: unknown): unknown {
	return normalizeTodoItems(value) ?? value;
}

function preprocessTodoIndex(value: unknown): unknown {
	return normalizeTodoIndex(value) ?? value;
}

function preprocessTodoStatus(value: unknown): unknown {
	return normalizeTodoStatus(value) ?? value;
}

export const todoManagerInputSchema = z.object({
	action: z
		.preprocess(preprocessTodoAction, z.enum(["write", "update", "list"]))
		.describe("The action to perform"),
	todos: z
		.preprocess(preprocessTodoItems, z.array(todoItemSchema))
		.optional()
		.describe("Array of todo items (required for 'write')"),
	index: z
		.preprocess(preprocessTodoIndex, z.number().int().positive())
		.optional()
		.describe("1-based index of the todo to update (required for 'update')"),
	status: z
		.preprocess(preprocessTodoStatus, z.enum(["pending", "in_progress", "completed", "cancelled"]))
		.optional()
		.describe("New status for the todo (used with 'update')"),
});

export const todoManager = tool({
	description: `Manage a todo list to plan and track your actions.

Actions:
- write: Replace the entire todo list. Each item can have its own status, so you can write the full list AND set one task to in_progress in a single call.
- update: Update a single todo's status by index (1-based)
- list: Show current todos

Use this only through the tool-calling interface. Never print todoManager JSON, tool arguments, or example tool calls in chat.`,
	inputSchema: todoManagerInputSchema,
	execute: async ({ action, todos: newTodos, index, status }) => {
		const context = getRuntimeContext();

		if (!context.sessionId) {
			return {
				success: false,
				error: "No active session for todos",
			};
		}

		await ensureTodosLoaded(context.sessionId);

		switch (action) {
			case "write": {
				if (newTodos === undefined) {
					return {
						success: false,
						error:
							"Todos are required for 'write'. Use an empty array only when intentionally clearing todos.",
					};
				}
				if (newTodos.length === 0) {
					currentTodos = [];
					await saveTodoList(context.sessionId, currentTodos);
					return {
						success: true,
						todos: formatTodoList(currentTodos),
					};
				}
				currentTodos = newTodos.map((t) => ({
					content: t.content,
					status: t.status || "pending",
				}));
				await saveTodoList(context.sessionId, currentTodos);
				return {
					success: true,
					todos: formatTodoList(currentTodos),
				};
			}

			case "update": {
				if (index === undefined) {
					return {
						success: false,
						error: "Index is required for 'update'",
					};
				}
				if (status === undefined) {
					return {
						success: false,
						error: "Status is required for 'update'",
					};
				}
				const idx = index - 1;
				if (currentTodos.length === 0) {
					return {
						success: false,
						error: "No todos are available to update. Use 'write' first.",
					};
				}
				if (idx < 0 || idx >= currentTodos.length) {
					return {
						success: false,
						error: `Invalid index ${index}. Valid range: 1-${currentTodos.length}`,
					};
				}
				const todo = currentTodos[idx]!;
				todo.status = status;
				await saveTodoList(context.sessionId, currentTodos);
				return {
					success: true,
					todos: formatTodoList(currentTodos),
				};
			}

			case "list": {
				return {
					success: true,
					todos: formatTodoList(currentTodos),
				};
			}

			default:
				return {
					success: false,
					error: `Unknown action: ${action}`,
				};
		}
	},
});

export function clearAllTodos(): void {
	currentTodos = [];
	lastSessionId = null;
}

export function getCurrentTodos(): TodoItem[] {
	return [...currentTodos];
}
