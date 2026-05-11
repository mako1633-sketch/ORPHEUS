import { afterEach, describe, expect, it } from "bun:test";
import {
	EXA_API_KEY_INVALID_MESSAGE,
	getExaClient,
	isCurrentExaApiKeyInvalid,
	markCurrentExaApiKeyInvalid,
	normalizeExaError,
	resetExaClientForTests,
} from "../src/ai/exa-client";

const ORIGINAL_ENV = { ...process.env };

describe("exa client key health", () => {
	afterEach(() => {
		process.env = { ...ORIGINAL_ENV };
		resetExaClientForTests();
	});

	it("reports missing EXA key unchanged", () => {
		process.env = { ...process.env, EXA_API_KEY: undefined };
		expect(getExaClient()).toEqual({ error: "EXA_API_KEY environment variable is not set" });
	});

	it("marks the current EXA key invalid", () => {
		process.env = { ...process.env, EXA_API_KEY: "bad-key" };
		markCurrentExaApiKeyInvalid();

		expect(isCurrentExaApiKeyInvalid()).toBe(true);
		expect(getExaClient()).toEqual({ error: EXA_API_KEY_INVALID_MESSAGE });
	});

	it("clears invalid state when the EXA key changes", () => {
		process.env = { ...process.env, EXA_API_KEY: "bad-key" };
		markCurrentExaApiKeyInvalid();
		process.env.EXA_API_KEY = "new-key";

		expect(isCurrentExaApiKeyInvalid()).toBe(false);
		expect("client" in getExaClient()).toBe(true);
	});

	it("normalizes auth failures and marks the key invalid", () => {
		process.env = { ...process.env, EXA_API_KEY: "bad-key" };

		expect(normalizeExaError(new Error("Invalid API key"))).toBe(EXA_API_KEY_INVALID_MESSAGE);
		expect(isCurrentExaApiKeyInvalid()).toBe(true);
	});
});
