import {
	detectAssistantResponseLeak,
	isAssistantResponseGuardNotice,
} from "../ai/assistant-response-guard";
import { isHonchoAvailable } from "../ai/memory/honcho-manager";
import { buildDaemonStatusItems } from "../ai/tools/daemon-status";
import type { ConversationMessage } from "../types";

export type HealthLevel = "ok" | "watch" | "repair" | "blocked";
export type HealthCheckId = "model" | "tools" | "memory" | "shell" | "search" | "session";

export interface HealthCheck {
	id: HealthCheckId;
	label: string;
	level: HealthLevel;
	summary: string;
	action: string;
}

export interface HealthSnapshot {
	level: HealthLevel;
	label: string;
	checks: HealthCheck[];
	needsAttention: number;
	updatedAt: number;
}

type DaemonStatusItem = Awaited<ReturnType<typeof buildDaemonStatusItems>>[number];

const STATUS_ITEMS_CACHE_TTL_MS = 10000;

let statusItemsCache: {
	items: DaemonStatusItem[];
	expiresAt: number;
} | null = null;

function rank(level: HealthLevel): number {
	switch (level) {
		case "blocked":
			return 3;
		case "repair":
			return 2;
		case "watch":
			return 1;
		default:
			return 0;
	}
}

function worstLevel(levels: HealthLevel[]): HealthLevel {
	return levels.reduce(
		(worst, level) => (rank(level) > rank(worst) ? level : worst),
		"ok" as HealthLevel
	);
}

function mapStatus(status: "ok" | "missing" | "invalid" | "unavailable"): HealthLevel {
	if (status === "ok") return "ok";
	if (status === "missing") return "watch";
	if (status === "invalid") return "repair";
	return "blocked";
}

async function getCachedStatusItems(): Promise<DaemonStatusItem[]> {
	const now = Date.now();
	if (statusItemsCache && statusItemsCache.expiresAt > now) {
		return statusItemsCache.items;
	}

	const items = await buildDaemonStatusItems();
	statusItemsCache = {
		items,
		expiresAt: now + STATUS_ITEMS_CACHE_TTL_MS,
	};
	return items;
}

export function clearOrpheusHealthCacheForTesting(): void {
	statusItemsCache = null;
}

function messageText(message: ConversationMessage): string {
	const parts = [message.content];
	for (const modelMessage of message.messages ?? []) {
		if (typeof modelMessage.content === "string") {
			parts.push(modelMessage.content);
		}
	}
	return parts.join("\n").trim();
}

function buildSessionCheck(conversationHistory: ConversationMessage[]): HealthCheck {
	const contaminated = conversationHistory.filter((message) => {
		if (message.type !== "daemon") return false;
		const text = messageText(message);
		return Boolean(detectAssistantResponseLeak(text) || isAssistantResponseGuardNotice(text));
	});

	if (contaminated.length === 0) {
		return {
			id: "session",
			label: "Session",
			level: "ok",
			summary: "Context clean.",
			action: "No repair needed.",
		};
	}

	return {
		id: "session",
		label: "Session",
		level: "repair",
		summary: `${contaminated.length} contaminated turn${contaminated.length === 1 ? "" : "s"} quarantined from model context.`,
		action: "Start a new session or undo the affected turn if behavior still feels off.",
	};
}

function compactLabel(level: HealthLevel, checks: HealthCheck[]): string {
	if (level === "ok") return "HEALTH OK";
	const severe = checks
		.filter((check) => check.level === level)
		.map((check) => check.label.toUpperCase())
		.slice(0, 2)
		.join("+");
	return `${level.toUpperCase()} ${severe}`;
}

function getStatusItems(statusItems: DaemonStatusItem[], ...ids: string[]): DaemonStatusItem[] {
	return statusItems.filter((item) => ids.includes(item.id));
}

function getStatusItem(statusItems: DaemonStatusItem[], id: string): DaemonStatusItem | undefined {
	return statusItems.find((item) => item.id === id);
}

function buildModelCheck(statusItems: DaemonStatusItem[]): HealthCheck {
	const openRouterKey = getStatusItem(statusItems, "OPENROUTER_API_KEY");
	const openRouterFormat = getStatusItem(statusItems, "format:OPENROUTER_API_KEY");
	const ollama = getStatusItem(statusItems, "ollama");
	const openRouterUsable = openRouterKey?.status === "ok" && openRouterFormat?.status === "ok";
	const ollamaUsable = ollama?.status === "ok";

	if (openRouterUsable || ollamaUsable) {
		return {
			id: "model",
			label: "Model",
			level: "ok",
			summary: openRouterUsable
				? "OpenRouter model route available."
				: "Local/Ollama model route available.",
			action: "No action needed.",
		};
	}

	if (openRouterFormat?.status === "invalid") {
		return {
			id: "model",
			label: "Model",
			level: "repair",
			summary: openRouterFormat.detail,
			action: "Replace OPENROUTER_API_KEY or select a working local/Ollama provider.",
		};
	}

	return {
		id: "model",
		label: "Model",
		level: "watch",
		summary: "No configured model route detected.",
		action: "Configure OpenRouter, Copilot, or a local/Ollama provider before expecting replies.",
	};
}

function buildToolsCheck(statusItems: DaemonStatusItem[]): HealthCheck {
	const tools = getStatusItems(statusItems, "subagent", "signal");
	if (tools.length === 0) {
		return {
			id: "tools",
			label: "Tools",
			level: "watch",
			summary: "No optional tool signals available.",
			action: "Run daemon status if tool availability looks wrong.",
		};
	}

	const unavailable = tools.filter((item) => item.status !== "ok");
	return {
		id: "tools",
		label: "Tools",
		level: "ok",
		summary:
			unavailable.length === 0
				? "Optional tools available."
				: `Optional tools disabled: ${unavailable.map((item) => item.label).join(", ")}.`,
		action:
			unavailable.length === 0 ? "No action needed." : "Configure only the optional tools you use.",
	};
}

function buildMemoryCheck(statusItems: DaemonStatusItem[]): HealthCheck {
	if (isHonchoAvailable()) {
		return {
			id: "memory",
			label: "Memory",
			level: "ok",
			summary: "Honcho memory route configured.",
			action: "No action needed.",
		};
	}

	const openAiItems = getStatusItems(statusItems, "OPENAI_API_KEY", "format:OPENAI_API_KEY");
	const failing = openAiItems.filter((item) => item.status !== "ok");
	return {
		id: "memory",
		label: "Memory",
		level: failing.some((item) => item.status === "invalid")
			? "repair"
			: failing.length > 0
				? "watch"
				: "ok",
		summary:
			failing.length === 0
				? "OpenAI-backed memory prerequisites available."
				: failing.map((item) => `${item.label}: ${item.detail}`).join(" "),
		action:
			failing.length === 0
				? "No action needed."
				: "Set OPENAI_API_KEY or configure Honcho for persistent memory.",
	};
}

function buildCheckFromItems(
	id: HealthCheckId,
	label: string,
	items: DaemonStatusItem[],
	okSummary: string,
	action: string
): HealthCheck {
	if (items.length === 0) {
		return { id, label, level: "watch", summary: "No health signal available.", action };
	}
	const level = worstLevel(items.map((item) => mapStatus(item.status)));
	const failing = items.filter((item) => item.status !== "ok");
	return {
		id,
		label,
		level,
		summary:
			failing.length === 0
				? okSummary
				: failing.map((item) => `${item.label}: ${item.detail}`).join(" "),
		action: failing.length === 0 ? "No action needed." : action,
	};
}

export async function buildOrpheusHealthSnapshot(
	params: {
		conversationHistory?: ConversationMessage[];
	} = {}
): Promise<HealthSnapshot> {
	const statusItems = await getCachedStatusItems();

	const checks: HealthCheck[] = [
		buildModelCheck(statusItems),
		buildToolsCheck(statusItems),
		buildMemoryCheck(statusItems),
		buildCheckFromItems(
			"shell",
			"Shell",
			getStatusItems(statusItems, "powershell"),
			"Shell execution path available.",
			"Install or repair PowerShell so local checks can run."
		),
		buildCheckFromItems(
			"search",
			"Search",
			getStatusItems(statusItems, "EXA_API_KEY", "format:EXA_API_KEY"),
			"Web search available.",
			"Set a valid EXA_API_KEY, or leave web tools disabled for local-only use."
		),
		buildSessionCheck(params.conversationHistory ?? []),
	];

	const level = worstLevel(checks.map((check) => check.level));
	return {
		level,
		label: compactLabel(level, checks),
		checks,
		needsAttention: checks.filter((check) => check.level !== "ok").length,
		updatedAt: Date.now(),
	};
}

export function formatHealthSnapshot(snapshot: HealthSnapshot): string {
	return snapshot.checks
		.map(
			(check) => `[${check.level.toUpperCase()}] ${check.label}: ${check.summary} ${check.action}`
		)
		.join("\n");
}
