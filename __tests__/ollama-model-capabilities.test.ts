import { describe, expect, it } from "bun:test";
import { getOllamaReasoningCapabilities } from "../src/utils/ollama-model-capabilities";

describe("getOllamaReasoningCapabilities", () => {
	it("marks deepseek-v4-pro cloud models as reasoning-capable with xhigh support", () => {
		expect(getOllamaReasoningCapabilities("deepseek-v4-pro:cloud")).toEqual({
			supportsReasoningEffort: true,
			supportsReasoningEffortXHigh: true,
		});
	});

	it("does not mark ordinary Ollama models as reasoning-capable", () => {
		expect(getOllamaReasoningCapabilities("llama3.1:8b")).toEqual({
			supportsReasoningEffort: false,
			supportsReasoningEffortXHigh: false,
		});
	});
});
