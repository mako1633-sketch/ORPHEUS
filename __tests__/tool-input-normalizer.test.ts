import { describe, expect, it } from "bun:test";
import { normalizeToolInputObject, parseJsonLikeInput } from "../src/ai/tool-input-normalizer";

describe("tool input normalizer", () => {
	it("parses JSON-like strings", () => {
		expect(parseJsonLikeInput('{"action":"list"}')).toEqual({ action: "list" });
		expect(parseJsonLikeInput("[1,2]")).toEqual([1, 2]);
	});

	it("returns object inputs only when object-shaped", () => {
		expect(normalizeToolInputObject('{"action":"list"}')).toEqual({ action: "list" });
		expect(normalizeToolInputObject("[1,2]")).toBeNull();
		expect(normalizeToolInputObject("hello")).toBeNull();
	});
});
