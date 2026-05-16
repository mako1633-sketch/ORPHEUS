import { existsSync } from "node:fs";
import { tool } from "ai";
import { z } from "zod";
import { getKeyHealth } from "../../utils/key-health";
import { loadCodingTaskState } from "../coding-task-state";
import { EXA_API_KEY_INVALID_MESSAGE, isCurrentExaApiKeyInvalid } from "../exa-client";
import { loadExecutiveState } from "../executive-state";
import { getHonchoManager, isHonchoAvailable } from "../memory/honcho-manager";
import { loadPersistentContext } from "../persistent-context";
import { getProviderCapabilities } from "../providers/capabilities";
import { loadTaskStack } from "../task-stack-state";
import { getWindowsPowerShellPath } from "./run-bash";
import { detectSignalCli } from "./signal";

type StatusLevel = "ok" | "missing" | "invalid" | "unavailable";

type StatusItem = {
	id: string;
	label: string;
	status: StatusLevel;
	detail: string;
	fix?: string;
};

function keyStatus(envName: string, invalid = false): StatusItem {
	const configured = Boolean(process.env[envName]);
	return {
		id: envName,
		label: envName,
		status: invalid ? "invalid" : configured ? "ok" : "missing",
		detail: invalid
			? `${envName} is configured but currently marked invalid.`
			: configured
				? "Configured."
				: "Not configured.",
		fix: configured ? undefined : `Set ${envName} in your environment or .env file.`,
	};
}

export async function buildDaemonStatusItems(): Promise<StatusItem[]> {
	const powerShellPath = getWindowsPowerShellPath();
	const signalCapability = await detectSignalCli();
	const providerCapabilities = getProviderCapabilities();
	const honchoStatus = getHonchoManager().getStatus();
	const shellLabel = process.platform === "win32" ? "Windows PowerShell" : "Local shell";
	const shellDetail =
		process.platform === "win32" ? powerShellPath : "Using bash for local commands.";

	return [
		...getKeyHealth().map((item) => ({
			id: `format:${item.name}`,
			label: `${item.name} format`,
			status:
				item.status === "configured"
					? ("ok" as const)
					: item.status === "missing"
						? ("missing" as const)
						: ("invalid" as const),
			detail: item.message,
		})),
		keyStatus("OPENAI_API_KEY"),
		keyStatus("OPENROUTER_API_KEY"),
		keyStatus("EXA_API_KEY", isCurrentExaApiKeyInvalid()),
		{
			id: "ollama",
			label: "Ollama endpoint",
			status: process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST ? "ok" : "missing",
			detail:
				process.env.OLLAMA_BASE_URL ||
				process.env.OLLAMA_HOST ||
				"Using provider defaults if Ollama is selected.",
		},
		{
			id: "powershell",
			label: shellLabel,
			status: process.platform === "win32" && !existsSync(powerShellPath) ? "unavailable" : "ok",
			detail: shellDetail,
		},
		{
			id: "signal",
			label: "Signal CLI",
			status: signalCapability.available ? "ok" : "unavailable",
			detail: signalCapability.available
				? "Available."
				: (signalCapability.reason ?? "signal-cli was not detected."),
			fix: signalCapability.available
				? undefined
				: "Install and configure signal-cli only if messaging is needed.",
		},
		{
			id: "subagent",
			label: "Subagents",
			status: providerCapabilities.supportsSubagentTool ? "ok" : "unavailable",
			detail: providerCapabilities.supportsSubagentTool
				? "Supported by the current provider."
				: "Unavailable for the current provider.",
			fix: providerCapabilities.supportsSubagentTool
				? undefined
				: "Use a provider/model route that supports tool-capable subagents.",
		},
		{
			id: "honcho",
			label: "Honcho memory",
			status: honchoStatus.configured ? "ok" : "missing",
			detail: honchoStatus.configured
				? honchoStatus.available
					? `Configured for workspace ${honchoStatus.workspaceId}.`
					: `Configured for workspace ${honchoStatus.workspaceId}; initializes on memory use.`
				: "Not configured.",
			fix: honchoStatus.configured
				? undefined
				: "Set HONCHO_API_KEY or HONCHO_BASE_URL, or HONCHO_ENABLED=true for local Honcho.",
		},
	];
}

function compactDashboard(items: StatusItem[]) {
	const rows = items.map((item) => ({
		id: item.id,
		label: item.label,
		status: item.status,
		detail: item.detail,
		fix: item.status === "ok" ? undefined : (item.fix ?? item.detail),
	}));
	return {
		label: rows.some((item) => item.status === "invalid" || item.status === "unavailable")
			? "HEALTH NEEDS ATTENTION"
			: rows.some((item) => item.status === "missing")
				? "HEALTH WATCH"
				: "HEALTH OK",
		rows,
		fixActions: rows
			.filter((item) => item.status !== "ok")
			.map((item) => `${item.label}: ${item.fix ?? item.detail}`)
			.slice(0, 8),
	};
}

function buildContextBudget(input: {
	promptTokens?: number;
	contextLength?: number;
	conversationChars?: number;
}): {
	status: "ok" | "watch" | "compact";
	percentUsed?: number;
	estimatedTokens?: number;
	recommendation: string;
} {
	const estimatedTokens =
		typeof input.promptTokens === "number"
			? input.promptTokens
			: typeof input.conversationChars === "number"
				? Math.ceil(input.conversationChars / 4)
				: undefined;
	const contextLength = input.contextLength;
	const percentUsed =
		estimatedTokens && contextLength
			? Math.round((estimatedTokens / contextLength) * 100)
			: undefined;

	if (percentUsed !== undefined && percentUsed >= 85) {
		return {
			status: "compact",
			percentUsed,
			estimatedTokens,
			recommendation:
				"Compact before the next large turn: preserve goal, evidence, touched files, checks, failures, and next step.",
		};
	}
	if (percentUsed !== undefined && percentUsed >= 65) {
		return {
			status: "watch",
			percentUsed,
			estimatedTokens,
			recommendation:
				"Start trimming repeated logs and persist task state before broad file reads or multi-step tool work.",
		};
	}
	return {
		status: "ok",
		percentUsed,
		estimatedTokens,
		recommendation:
			"Context budget looks usable. Keep large outputs summarized and persist important task state.",
	};
}

async function buildLaunchBriefing(items: StatusItem[]) {
	const [codingTask, executiveState, persistentContext, taskStack] = await Promise.all([
		loadCodingTaskState(),
		loadExecutiveState(),
		loadPersistentContext(),
		loadTaskStack(),
	]);
	const openExecutive = executiveState.items.filter(
		(item) => item.status === "open" || item.status === "blocked"
	);
	const dashboard = compactDashboard(items);
	return {
		health: dashboard.label,
		attention: dashboard.fixActions,
		activeCodingTask: codingTask
			? {
					goal: codingTask.goal,
					status: codingTask.status,
					nextStep: codingTask.nextStep,
					failures: codingTask.failures.slice(-5),
				}
			: null,
		executive: {
			openCount: openExecutive.length,
			blocked: openExecutive.filter((item) => item.status === "blocked").slice(0, 5),
			risks: openExecutive.filter((item) => item.kind === "risk").slice(-5),
			waitingOn: openExecutive.filter((item) => item.kind === "waiting_on").slice(-5),
		},
		taskStack: {
			total: taskStack.items.length,
			active: taskStack.items.filter((item) => item.status === "active"),
			queued: taskStack.items.filter((item) => item.status === "queued").slice(0, 8),
			blocked: taskStack.items.filter((item) => item.status === "blocked").slice(0, 8),
		},
		memory: {
			persistentContextChars: persistentContext.length,
			persistentContextEmpty: persistentContext.length === 0,
			honchoConfigured: isHonchoAvailable(),
		},
		nextSuggestedAction:
			dashboard.fixActions[0] ??
			codingTask?.nextStep ??
			openExecutive.find((item) => item.status === "blocked")?.title ??
			"Pick an active project or run a project doctor.",
	};
}

export const daemonStatus = tool({
	description:
		"Run a local ORPHEUS capability doctor check. Reports provider key presence, EXA key health, local shell readiness, Signal CLI availability, subagent support, capability dashboards, context budget, and launch briefings without revealing secret values.",
	inputSchema: z.object({
		scope: z
			.enum(["all", "dashboard", "contextBudget", "launchBriefing"])
			.default("all")
			.describe("Status scope."),
		promptTokens: z.number().int().min(0).optional(),
		contextLength: z.number().int().min(1).optional(),
		conversationChars: z.number().int().min(0).optional(),
	}),
	execute: async (input) => {
		const items = await buildDaemonStatusItems();
		if (input.scope === "contextBudget") {
			return {
				success: true,
				scope: input.scope,
				contextBudget: buildContextBudget(input),
			};
		}
		if (input.scope === "dashboard") {
			return {
				success: true,
				scope: input.scope,
				dashboard: compactDashboard(items),
			};
		}
		if (input.scope === "launchBriefing") {
			return {
				success: true,
				scope: input.scope,
				briefing: await buildLaunchBriefing(items),
			};
		}
		const invalidExa = items.find((item) => item.id === "EXA_API_KEY" && item.status === "invalid");
		return {
			success: true,
			items: items.map((item) =>
				item.id === "EXA_API_KEY" && item.status === "invalid"
					? { ...item, detail: EXA_API_KEY_INVALID_MESSAGE }
					: item
			),
			summary: {
				ok: items.filter((item) => item.status === "ok").length,
				needsAttention: items.filter((item) => item.status !== "ok").length,
				exaInvalid: Boolean(invalidExa),
			},
		};
	},
});
