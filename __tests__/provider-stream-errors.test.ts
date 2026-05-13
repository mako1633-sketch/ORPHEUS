import { describe, expect, test } from "bun:test";
import {
	addTransientProviderContext,
	isTransientProviderStreamError,
	normalizeProviderStreamError,
} from "../src/ai/providers/stream-errors";

describe("provider stream errors", () => {
	test("adds provider context to bare bad request errors", () => {
		const error = normalizeProviderStreamError(new Error("Bad Request"), "Ollama");

		expect(error.message).toBe("Ollama rejected the request: Bad Request");
	});

	test("extracts HTTP status and response body details", () => {
		const error = normalizeProviderStreamError(
			{
				statusCode: 400,
				statusText: "Bad Request",
				responseBody: { error: { message: "tool messages are malformed" } },
			},
			"Ollama"
		);

		expect(error.message).toBe("HTTP 400: Bad Request: tool messages are malformed");
	});

	test("classifies transient service failures", () => {
		expect(
			isTransientProviderStreamError({
				statusCode: 503,
				statusText: "Service Unavailable",
			})
		).toBe(true);
		expect(isTransientProviderStreamError(new Error("socket hang up"))).toBe(true);
		expect(isTransientProviderStreamError(new Error("invalid authentication header"))).toBe(false);
	});

	test("adds user-actionable context to transient failures", () => {
		const error = addTransientProviderContext(new Error("HTTP 503: Service Unavailable"), "Ollama");

		expect(error.message).toContain("Transient provider/service issue from Ollama");
		expect(error.message).toContain("The turn was preserved");
	});
});
