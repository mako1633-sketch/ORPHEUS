import { afterEach, describe, expect, it } from "bun:test";
import {
	EXA_API_KEY_INVALID_MESSAGE,
	markCurrentExaApiKeyInvalid,
	resetExaClientForTests,
} from "../src/ai/exa-client";
import { buildDaemonStatusItems } from "../src/ai/tools/daemon-status";

const ORIGINAL_ENV = { ...process.env };

describe("daemon status", () => {
	afterEach(() => {
		process.env = { ...ORIGINAL_ENV };
		resetExaClientForTests();
	});

	it("reports key presence without exposing values", async () => {
		process.env = {
			...process.env,
			OPENAI_API_KEY: "sk-test-secret",
			OPENROUTER_API_KEY: undefined,
			EXA_API_KEY: undefined,
		};

		const items = await buildDaemonStatusItems();
		const openAi = items.find((item) => item.id === "OPENAI_API_KEY");
		const openRouter = items.find((item) => item.id === "OPENROUTER_API_KEY");

		expect(openAi?.status).toBe("ok");
		expect(openAi?.detail).not.toContain("sk-test-secret");
		expect(openRouter?.status).toBe("missing");
	});

	it("marks the current EXA key invalid", async () => {
		process.env = { ...process.env, EXA_API_KEY: "bad-exa" };
		markCurrentExaApiKeyInvalid();

		const items = await buildDaemonStatusItems();
		const exa = items.find((item) => item.id === "EXA_API_KEY");

		expect(exa?.status).toBe("invalid");
		expect(exa?.detail).toContain("EXA_API_KEY");
		expect(EXA_API_KEY_INVALID_MESSAGE).toContain("EXA_API_KEY is invalid");
	});
});
