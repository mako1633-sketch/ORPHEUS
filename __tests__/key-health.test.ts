import { describe, expect, it } from "bun:test";
import { getKeyHealth } from "../src/utils/key-health";

describe("key health", () => {
	it("reports missing and configured keys without exposing values", () => {
		const health = getKeyHealth({
			OPENAI_API_KEY: "sk-secret",
			OPENROUTER_API_KEY: undefined,
			EXA_API_KEY: "exa-secret",
		});

		expect(health.find((item) => item.name === "OPENAI_API_KEY")?.status).toBe("configured");
		expect(health.find((item) => item.name === "OPENROUTER_API_KEY")?.status).toBe("missing");
		expect(JSON.stringify(health)).not.toContain("sk-secret");
	});

	it("flags obvious prefix mistakes", () => {
		const health = getKeyHealth({
			OPENAI_API_KEY: "not-openai",
			OPENROUTER_API_KEY: "not-openrouter",
		});

		expect(health.find((item) => item.name === "OPENAI_API_KEY")?.status).toBe("invalid-format");
		expect(health.find((item) => item.name === "OPENROUTER_API_KEY")?.status).toBe(
			"invalid-format"
		);
	});
});
