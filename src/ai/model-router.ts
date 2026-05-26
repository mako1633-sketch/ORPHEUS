/**
 * Adaptive Model Router
 * Automatically selects the best provider + model based on the task type,
 * sensitivity, parallelism needs, and current system state.
 */

import type { AttachmentInfo, LlmProvider } from "../types";
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
	restoreAfterTurn?: {
		provider: LlmProvider;
		modelId: string;
	};
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

/** Check if the current model supports vision/image input */
function hasVisionCapability(): boolean {
	const provider = getModelProvider();
	const model = getResponseModel().toLowerCase();

	if (provider === "openrouter") {
		// OpenRouter models known to support vision
		const visionModels = [
			"claude",
			"sonnet",
			"gpt-4o",
			"gpt-4.5",
			"gemini",
			"vision",
			"qwen",
			"pixtral",
		];
		return visionModels.some((v) => model.includes(v));
	}

	if (provider === "copilot") {
		// Copilot GPT-4o models support vision
		return model.includes("4o") || model.includes("o3") || model.includes("o1");
	}

	if (provider === "ollama") {
		// Ollama models known to support vision
		const visionModels = [
			"llava",
			"bakllava",
			"moondream",
			"llama3.2-vision",
			"llama3.2-vision-preview",
			"qwen2.5-vl",
			"minicpm-v",
		];
		return visionModels.some((v) => model.includes(v));
	}

	return false;
}

/**
 * Route a user message to the optimal provider/model configuration.
 * If image attachments are present and the current model doesn't support vision,
 * attempt to switch to a vision-capable model on the same provider.
 */
export async function routeTask(
	userMessage: string,
	attachments?: AttachmentInfo[]
): Promise<RouterDecision> {
	const currentProvider = getModelProvider();
	const isSensitive = matchesAny(userMessage, SENSITIVE_PATTERNS);
	const needsParallel = matchesAny(userMessage, PARALLEL_PATTERNS);
	const needsWeb = matchesAny(userMessage, WEB_NEEDED_PATTERNS);
	const isCode = isCodingTask(userMessage);
	const ollamaOnline = await isOllamaOnline();

	// Check if we have image attachments but no vision support
	const hasImageAttachments = attachments?.some((a) => a.isImage) ?? false;
	const needsVision = hasImageAttachments && !hasVisionCapability();

	// Priority 0: Image attachments with no vision support → switch to vision model
	if (needsVision) {
		const visionModel =
			currentProvider === "openrouter"
				? "anthropic/claude-3.5-sonnet"
				: currentProvider === "copilot"
					? "gpt-4o"
					: getResponseModel();
		return {
			provider: currentProvider,
			modelId: visionModel,
			reason: "Image attachments detected — routing to vision-capable model",
			useSubagents: needsParallel,
			restoreAfterTurn: {
				provider: currentProvider,
				modelId: getResponseModel(),
			},
		};
	}

	// Priority 1: Sensitive content -> Ollama (local, private)
	if (isSensitive && ollamaOnline) {
		return {
			provider: "ollama",
			modelId: getResponseModelForProvider("ollama"),
			reason: "Sensitive content detected — routing to local Ollama for privacy",
			useSubagents: needsParallel,
		};
	}

	// Priority 2: Coding tasks -> Copilot Codex, then restore the user's normal provider.
	if (isCode) {
		return {
			provider: "copilot",
			modelId: getCopilotCodingModel(),
			reason: "Coding task detected — using Copilot Codex",
			useSubagents: false,
			restoreAfterTurn:
				currentProvider === "copilot"
					? undefined
					: {
							provider: currentProvider,
							modelId: getResponseModel(),
						},
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
