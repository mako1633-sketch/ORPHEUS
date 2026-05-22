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

	it("routes coding tasks from Ollama to Copilot Codex temporarily", async () => {
		setModelProvider("ollama");
		setResponseModelForProvider("ollama", "kimi-k2.6:cloud");

		const decision = await routeTask("Please fix this TypeScript bug");

		expect(decision.provider).toBe("copilot");
		expect(decision.modelId).toBe(getResponseModelForProvider("copilot"));
		expect(decision.restoreAfterTurn).toEqual({
			provider: "ollama",
			modelId: "kimi-k2.6:cloud",
		});
		expect(getModelProvider()).toBe("ollama");
	});

	it("does not route local current-state requests to Copilot", async () => {
		setModelProvider("ollama");
		setResponseModelForProvider("ollama", "kimi-k2.6:cloud");

		const decision = await routeTask(
			"Save this current working state to memory and implement a checkpoint system."
		);

		expect(decision.provider).toBe("ollama");
		expect(decision.modelId).toBe("kimi-k2.6:cloud");
	});

	it("keeps explicit web requests on Ollama unless Copilot is selected", async () => {
		setModelProvider("ollama");
		setResponseModelForProvider("ollama", "kimi-k2.6:cloud");

		const decision = await routeTask("Search the web for the latest release notes");

		expect(decision.provider).toBe("ollama");
		expect(decision.modelId).toBe("kimi-k2.6:cloud");
	});

	it("uses Codex for coding tasks when Copilot is the selected provider", async () => {
		setModelProvider("copilot");

		const decision = await routeTask("Please fix this TypeScript bug");

		expect(decision.provider).toBe("copilot");
		expect(decision.modelId).toBe(getResponseModelForProvider("copilot"));
		expect(decision.restoreAfterTurn).toBeUndefined();
	});
});
