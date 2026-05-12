/**
 * Memory injection for first message context.
 * Retrieves relevant memories and formats them for system prompt injection.
 */

import type { MemoryContext, MemoryEntry } from "../../types";
import { debug } from "../../utils/debug-logger";
import { getRuntimeContext } from "../../state/runtime-context";
import { detectAssistantResponseLeak, isAssistantResponseGuardNotice } from "../assistant-response-guard";
import { loadCodingTaskState } from "../coding-task-state";
import { formatPersistentContextForPrompt, loadPersistentContext } from "../persistent-context";
import { getHonchoManager, isHonchoAvailable } from "./honcho-manager";
import { getMemoryManager, isMemoryAvailable } from "./memory-manager";

function isContaminatedMemoryText(text: string): boolean {
	const trimmed = text.trim();
	return Boolean(
		trimmed && (detectAssistantResponseLeak(trimmed) || isAssistantResponseGuardNotice(trimmed))
	);
}

/** Format memories for injection into message context */
function formatMemoriesForInjection(memories: MemoryEntry[]): string {
	if (memories.length === 0) {
		return "";
	}

	const cleanMemories = memories.filter((memory) => !isContaminatedMemoryText(memory.memory));
	if (cleanMemories.length === 0) return "";

	const formatted = cleanMemories.map((m, i) => `${i + 1}. ${m.memory}`).join("\n");

	return `<relevant-memories>
The following memories from previous sessions may be relevant:

${formatted}

Use this context to provide more personalized and informed responses.
</relevant-memories>`;
}

async function formatCodingTaskStateForPrompt(): Promise<string> {
	const state = await loadCodingTaskState();
	if (!state || state.status === "completed") return "";

	const lines = [
		`Goal: ${state.goal}`,
		`Status: ${state.status}`,
		state.filesInspected.length ? `Files inspected: ${state.filesInspected.join(", ")}` : "",
		state.filesChanged.length ? `Files changed: ${state.filesChanged.join(", ")}` : "",
		state.checksRun.length ? `Checks run: ${state.checksRun.join(", ")}` : "",
		state.failures.length ? `Failures: ${state.failures.join(" | ")}` : "",
		state.nextStep ? `Next step: ${state.nextStep}` : "",
	].filter(Boolean);

	return `<active-coding-task>
The previous coding task may still be in progress. Use this only when relevant:

${lines.join("\n")}
</active-coding-task>`;
}

/** Retrieve relevant memories for a user message */
export async function getMemoryContextForMessage(
	userMessage: string,
	limit = 5
): Promise<MemoryContext | null> {
	if (!isMemoryAvailable()) {
		return null;
	}

	const memoryManager = getMemoryManager();
	await memoryManager.initialize();

	if (!memoryManager.isAvailable) {
		return null;
	}

	try {
		const memories = await memoryManager.search(userMessage, limit);

		debug.info("memory-injection", {
			message: "Retrieved memories for message",
			query: userMessage.slice(0, 50),
			memoryCount: memories.length,
		});

		return {
			memories,
			retrievedAt: Date.now(),
			query: userMessage,
		};
	} catch (error) {
		debug.error("memory-injection", {
			message: "Failed to retrieve memories",
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

/** Build memory injection text for the first message */
export async function buildMemoryInjection(
	userMessage: string,
	options: { limit?: number } = {}
): Promise<string> {
	const { limit = 5 } = options;
	const sections: string[] = [];

	const persistentContext = formatPersistentContextForPrompt(await loadPersistentContext());
	if (persistentContext && !isContaminatedMemoryText(persistentContext)) {
		sections.push(persistentContext);
	}

	const codingTaskState = await formatCodingTaskStateForPrompt();
	if (codingTaskState && !isContaminatedMemoryText(codingTaskState)) {
		sections.push(codingTaskState);
	}

	const context = await getMemoryContextForMessage(userMessage, limit);

	if (context && context.memories.length > 0) {
		sections.push(formatMemoriesForInjection(context.memories));
	}

	if (isHonchoAvailable()) {
		const runtimeContext = getRuntimeContext();
		const honchoContext = await getHonchoManager().buildContext({
			sessionId: runtimeContext.sessionId,
			query: userMessage,
		});
		if (honchoContext && !isContaminatedMemoryText(honchoContext)) {
			sections.push(`<honcho-context>
The following conversation context was retrieved from Honcho:

${honchoContext}

Use this context when it is relevant to the user's current message.
</honcho-context>`);
		}
	}

	return sections.filter(Boolean).join("\n\n");
}
