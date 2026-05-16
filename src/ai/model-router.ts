/**
 * Adaptive Model Router
 * Automatically selects the best provider + model based on the task type,
 * sensitivity, parallelism needs, and current system state.
 */

import type { LlmProvider } from "../types";
import { debug } from "../utils/debug-logger";
import {
	getCopilotCodingModel,
	getModelProvider,
	getOllamaBaseUrl,
	getResponseModel,
	getResponseModelForProvider,
	isCodingTask,
	setModelProvider,
	setResponseModelForProvider,
} from "./model-config";

export interface RouterDecision {
	provider: LlmProvider;
	modelId: string;
	reason: string;
	useSubagents: boolean;
}

const SENSITIVE_PATTERNS = [
	"password",
	"secret",
	"token",
	"key",
	"credential",
	"auth",
	"private key",
	"api key",
	"ssh key",
	"env",
	".env",
	"dpapi",
	"lsass",
	"sam",
	"security hive",
];

const PARALLEL_PATTERNS = [
	"check all",
	"audit all",
	"scan all",
	"list all",
	"verify all",
	"multiple",
	"every repo",
	"all repos",
	"all files",
	"bulk",
];

const WEB_NEEDED_PATTERNS = [
	"latest news",
	"current web",
	"current online",
	"look up",
	"web search",
	"search the web",
	"search online",
	"cve",
	"vulnerability",
	"release notes",
	"changelog",
	"breaking change",
	"deprecated",
];

function getOllamaApiBaseUrl(): string {
	return getOllamaBaseUrl()
		.replace(/\/v1\/?$/, "")
		.replace(/\/$/, "");
}

function matchesAny(text: string, patterns: string[]): boolean {
	const lower = text.toLowerCase();
	return patterns.some((p) => lower.includes(p.toLowerCase()));
}

async function isOllamaOnline(): Promise<boolean> {
	try {
		const res = await fetch(`${getOllamaApiBaseUrl()}/api/tags`, {
			signal: AbortSignal.timeout(2000),
		});
		return res.ok;
	} catch {
		return false;
	}
}

/**
 * Route a user message to the optimal provider/model configuration.
 */
export async function routeTask(userMessage: string): Promise<RouterDecision> {
	const currentProvider = getModelProvider();
	const isSensitive = matchesAny(userMessage, SENSITIVE_PATTERNS);
	const needsParallel = matchesAny(userMessage, PARALLEL_PATTERNS);
	const needsWeb = matchesAny(userMessage, WEB_NEEDED_PATTERNS);
	const isCode = isCodingTask(userMessage);
	const ollamaOnline = await isOllamaOnline();

	// Priority 1: Sensitive content -> Ollama (local, private)
	if (isSensitive && ollamaOnline) {
		return {
			provider: "ollama",
			modelId: getResponseModelForProvider("ollama"),
			reason: "Sensitive content detected — routing to local Ollama for privacy",
			useSubagents: needsParallel,
		};
	}

	// Priority 2: Coding tasks on Copilot -> Codex model
	if (isCode && currentProvider === "copilot") {
		return {
			provider: "copilot",
			modelId: getCopilotCodingModel(),
			reason: "Coding task detected on Copilot — using Copilot Codex",
			useSubagents: needsParallel,
		};
	}

	// Priority 3: Web/current-info tasks on Copilot -> keep Copilot selected
	if (needsWeb && currentProvider === "copilot") {
		return {
			provider: "copilot",
			modelId: getResponseModelForProvider("copilot"),
			reason: "Query requires current web data on Copilot — keeping Copilot selected",
			useSubagents: needsParallel,
		};
	}

	// Priority 4: Parallel work -> keep current provider but spawn subagents
	if (needsParallel) {
		return {
			provider: currentProvider,
			modelId: getResponseModel(),
			reason: "Parallel checks detected — keeping current provider with subagents",
			useSubagents: true,
		};
	}

	// Default: keep current provider
	return {
		provider: currentProvider,
		modelId: getResponseModel(),
		reason: "General task — using current provider",
		useSubagents: false,
	};
}

/** Apply the router decision to the global model state */
export function applyRouterDecision(decision: RouterDecision): void {
	setModelProvider(decision.provider);
	setResponseModelForProvider(decision.provider, decision.modelId);
	debug.info("model-router", {
		message: "Routed task",
		provider: decision.provider,
		model: decision.modelId,
		reason: decision.reason,
		useSubagents: decision.useSubagents,
	});
}
