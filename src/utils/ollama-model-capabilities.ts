import type { ModelOption } from "../types";

function normalizeModelId(modelId: string): string {
	return modelId.trim().toLowerCase();
}

export function getOllamaReasoningCapabilities(
	modelId: string
): Pick<ModelOption, "supportsReasoningEffort" | "supportsReasoningEffortXHigh"> {
	const normalized = normalizeModelId(modelId);
	const supportsReasoning =
		normalized.includes("deepseek-v4-pro") ||
		normalized.includes("deepseek-v4-flash") ||
		normalized.includes("deepseek-r1");

	return {
		supportsReasoningEffort: supportsReasoning,
		supportsReasoningEffortXHigh: supportsReasoning && normalized.includes("deepseek-v4-pro"),
	};
}

export function withOllamaReasoningCapabilities(model: ModelOption): ModelOption {
	const capabilities = getOllamaReasoningCapabilities(model.id);
	return capabilities.supportsReasoningEffort ? { ...model, ...capabilities } : model;
}
