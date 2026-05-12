import { describe, expect, test } from "bun:test";
import { normalizeProviderStreamError } from "../src/ai/providers/stream-errors";

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
});
