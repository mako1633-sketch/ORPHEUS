import { afterEach, describe, expect, it } from "bun:test";
import {
	DEFAULT_MODEL_PROVIDER,
	getModelProvider,
	getResponseModelForProvider,
	setModelProvider,
	setResponseModelForProvider,
} from "../src/ai/model-config";
import { routeTask } from "../src/ai/model-router";

describe("model router", () => {
	afterEach(() => {
		setModelProvider(DEFAULT_MODEL_PROVIDER);
	});

	it("keeps coding tasks on Ollama when Ollama is the selected provider", async () => {
		setModelProvider("ollama");
		setResponseModelForProvider("ollama", "kimi-k2.6:cloud");

		const decision = await routeTask("Please fix this TypeScript bug");

		expect(decision.provider).toBe("ollama");
		expect(decision.modelId).toBe("kimi-k2.6:cloud");
		expect(getModelProvider()).toBe("ollama");
	});

	it("uses Codex for coding tasks when Copilot is the selected provider", async () => {
		setModelProvider("copilot");

		const decision = await routeTask("Please fix this TypeScript bug");

		expect(decision.provider).toBe("copilot");
		expect(decision.modelId).toBe(getResponseModelForProvider("copilot"));
	});
});
