/**
 * Memory injection for first message context.
 * Retrieves relevant memories and formats them for system prompt injection.
 * Now includes: Ollama semantic memory, knowledge base, reflection context,
 * system health monitor, and vision reasoning state.
 */

import { getRuntimeContext } from "../../state/runtime-context";
import type { MemoryContext, MemoryEntry } from "../../types";
import { debug } from "../../utils/debug-logger";
import {
	detectAssistantResponseLeak,
	isAssistantResponseGuardNotice,
} from "../assistant-response-guard";
import { loadCodingTaskState } from "../coding-task-state";
import { buildExecutiveBriefing } from "../executive-state";
import { formatKnowledgeHits, searchKnowledgeBase } from "../knowledge-base";
import { isCodingTask } from "../model-config";
import { ollamaSearchMemories } from "../ollama-memory";
import { formatPersistentContextForPrompt, loadPersistentContext } from "../persistent-context";
import { buildReflectionContext } from "../reflection-state";
import { formatMonitorReport, runSystemMonitor } from "../system-monitor";
import { loadTaskStack } from "../task-stack-state";
import { getHonchoManager, isHonchoAvailable } from "./honcho-manager";
import { getMemoryManager, isMemoryAvailable } from "./memory-manager";

function isContaminatedMemoryText(text: string): boolean {
	const trimmed = text.trim();
	return Boolean(
		trimmed && (detectAssistantResponseLeak(trimmed) || isAssistantResponseGuardNotice(trimmed))
	);
}

function isExecutiveContextRequest(userMessage: string): boolean {
	return /\b(briefing|dashboard|priority|priorities|follow[- ]?up|waiting on|decision|risk|backlog|stack|queue|roadmap)\b/i.test(
		userMessage
	);
}

function isSystemHealthRequest(userMessage: string): boolean {
	return /\b(system health|health check|doctor|diagnostic|memory pressure|ram|disk|storage|node_modules|setup|install|configured|configuration)\b/i.test(
		userMessage
	);
}

function isKnowledgeContextRequest(userMessage: string): boolean {
	return /\b(remember|memory|previous|prior|earlier|notes|knowledge|indexed|documents|docs|where did|what did we)\b/i.test(
		userMessage
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

async function formatExecutiveBriefingForPrompt(): Promise<string> {
	const briefing = await buildExecutiveBriefing();
	const totalOpen = Object.values(briefing.counts).reduce((sum, count) => sum + count, 0);
	if (totalOpen === 0) return "";

	const attention = [
		briefing.overdue.length
			? `Overdue: ${briefing.overdue.map((item) => item.title).join("; ")}`
			: "",
		briefing.upcoming.length
			? `Due soon: ${briefing.upcoming.map((item) => item.title).join("; ")}`
			: "",
		briefing.counts.waiting_on ? `Waiting on: ${briefing.counts.waiting_on}` : "",
		briefing.counts.risk ? `Risks: ${briefing.counts.risk}` : "",
		briefing.counts.decision ? `Open decisions: ${briefing.counts.decision}` : "",
	].filter(Boolean);

	return `<executive-briefing>
Local ORPHEUS executive context is available. Use it when relevant:

${attention.join("\n") || `Open items: ${totalOpen}`}
</executive-briefing>`;
}

async function formatTaskStackForPrompt(): Promise<string> {
	const stack = await loadTaskStack();
	const open = stack.items.filter(
		(item) => item.status === "active" || item.status === "queued" || item.status === "blocked"
	);
	if (open.length === 0) return "";

	const lines = open.slice(0, 12).map((item) => {
		return `- [${item.status}] [${item.priority}] ${item.title}${item.nextStep ? ` — next: ${item.nextStep}` : ""}`;
	});

	return `<orpheus-task-stack>
Durable ORPHEUS task stack across sessions:

${lines.join("\n")}
</orpheus-task-stack>`;
}

async function formatOllamaMemoriesForPrompt(userMessage: string): Promise<string> {
	try {
		const memories = await ollamaSearchMemories(userMessage, 3);
		if (memories.length === 0) return "";
		const formatted = memories.map((m, i) => `${i + 1}. ${m.memory}`).join("\n");
		return `<ollama-memories>
Local semantic memories (Ollama-powered):

${formatted}
</ollama-memories>`;
	} catch {
		return "";
	}
}

async function formatKnowledgeBaseForPrompt(userMessage: string): Promise<string> {
	try {
		const hits = await searchKnowledgeBase(userMessage, 3);
		return formatKnowledgeHits(hits);
	} catch {
		return "";
	}
}

async function formatReflectionContextForPrompt(userMessage: string): Promise<string> {
	try {
		// Auto-detect likely task type from message keywords
		const lower = userMessage.toLowerCase();
		let taskType: "coding" | "debug" | "setup" | "security" | "general" = "general";
		if (lower.includes("code") || lower.includes("program")) taskType = "coding";
		else if (lower.includes("bug") || lower.includes("error") || lower.includes("fix"))
			taskType = "debug";
		else if (lower.includes("setup") || lower.includes("install") || lower.includes("config"))
			taskType = "setup";
		else if (lower.includes("security") || lower.includes("audit") || lower.includes("assessment"))
			taskType = "security";
		return await buildReflectionContext(taskType);
	} catch {
		return "";
	}
}

async function formatSystemHealthForPrompt(): Promise<string> {
	try {
		const report = await runSystemMonitor();
		return formatMonitorReport(report);
	} catch {
		return "";
	}
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
	const codingRequest = isCodingTask(userMessage);
	const executiveRequest = isExecutiveContextRequest(userMessage);
	const healthRequest = isSystemHealthRequest(userMessage);
	const knowledgeRequest = isKnowledgeContextRequest(userMessage);

	const persistentContext = formatPersistentContextForPrompt(await loadPersistentContext());
	if (persistentContext && !isContaminatedMemoryText(persistentContext)) {
		sections.push(persistentContext);
	}

	const codingTaskState = await formatCodingTaskStateForPrompt();
	if (codingTaskState && !isContaminatedMemoryText(codingTaskState)) {
		sections.push(codingTaskState);
	}

	if (!codingRequest || executiveRequest) {
		const executiveBriefing = await formatExecutiveBriefingForPrompt();
		if (executiveBriefing && !isContaminatedMemoryText(executiveBriefing)) {
			sections.push(executiveBriefing);
		}
	}

	if (!codingRequest || executiveRequest) {
		const taskStack = await formatTaskStackForPrompt();
		if (taskStack && !isContaminatedMemoryText(taskStack)) {
			sections.push(taskStack);
		}
	}

	const context = await getMemoryContextForMessage(userMessage, limit);
	if (context && context.memories.length > 0) {
		sections.push(formatMemoriesForInjection(context.memories));
	}

	if (!codingRequest || knowledgeRequest) {
		const ollamaMemories = await formatOllamaMemoriesForPrompt(userMessage);
		if (ollamaMemories && !isContaminatedMemoryText(ollamaMemories)) {
			sections.push(ollamaMemories);
		}
	}

	if (!codingRequest || knowledgeRequest) {
		const knowledgeBase = await formatKnowledgeBaseForPrompt(userMessage);
		if (knowledgeBase && !isContaminatedMemoryText(knowledgeBase)) {
			sections.push(knowledgeBase);
		}
	}

	const reflectionContext = await formatReflectionContextForPrompt(userMessage);
	if (reflectionContext && !isContaminatedMemoryText(reflectionContext)) {
		sections.push(reflectionContext);
	}

	if (!codingRequest || healthRequest) {
		const systemHealth = await formatSystemHealthForPrompt();
		if (systemHealth && !isContaminatedMemoryText(systemHealth)) {
			sections.push(systemHealth);
		}
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
