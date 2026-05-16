import { afterEach, describe, expect, it } from "bun:test";
import {
	DEFAULT_CODEX_COPILOT_MODEL_ID,
	getCopilotCodingModel,
	isCodingTask,
	resolveCopilotCodingModel,
} from "../src/ai/model-config";

const ORIGINAL_CODEX_CODING_MODEL = process.env.CODEX_CODING_MODEL;

describe("model config", () => {
	afterEach(() => {
		if (ORIGINAL_CODEX_CODING_MODEL === undefined) {
			process.env.CODEX_CODING_MODEL = undefined;
		} else {
			process.env.CODEX_CODING_MODEL = ORIGINAL_CODEX_CODING_MODEL;
		}
	});

	it("uses CODEX_CODING_MODEL when explicitly configured", () => {
		process.env.CODEX_CODING_MODEL = "gpt-5.2-codex";

		expect(getCopilotCodingModel()).toBe("gpt-5.2-codex");
		expect(resolveCopilotCodingModel([{ id: "gpt-5.2-codex", name: "GPT 5.2 Codex" }])).toBe(
			"gpt-5.2-codex"
		);
	});

	it("falls back to the best available Codex-like Copilot model", () => {
		process.env.CODEX_CODING_MODEL = undefined;

		expect(
			resolveCopilotCodingModel([
				{ id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
				{ id: "gpt-5.2-codex", name: "GPT 5.2 Codex" },
				{ id: "gpt-5.1-codex", name: "GPT 5.1 Codex" },
				{ id: "o4-mini", name: "o4 mini" },
			])
		).toBe("gpt-5.2-codex");
	});

	it("keeps the default when no available model list is provided", () => {
		process.env.CODEX_CODING_MODEL = undefined;

		expect(resolveCopilotCodingModel()).toBe(DEFAULT_CODEX_COPILOT_MODEL_ID);
	});

	it("detects likely coding tasks without flagging ordinary chat", () => {
		expect(isCodingTask("Please fix the TypeScript CLI build")).toBe(true);
		expect(isCodingTask("Refactor the auth middleware")).toBe(true);
		expect(isCodingTask("Why is UserMenu.tsx crashing?")).toBe(true);
		expect(isCodingTask("Run the failing tests and patch the repo")).toBe(true);
		expect(isCodingTask("How are you today?")).toBe(false);
		expect(isCodingTask("Write a friendly birthday note")).toBe(false);
	});
});
