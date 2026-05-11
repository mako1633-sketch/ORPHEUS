import { describe, expect, it } from "bun:test";
import {
	runDirectImplementationAdvice,
	shouldRunDirectImplementationAdvice,
} from "../src/ai/direct-implementation-advice-runner";

describe("direct implementation advice runner", () => {
	it("routes immediate implementation prompts away from generic model output", () => {
		expect(shouldRunDirectImplementationAdvice("What can you implement right now?")).toBe(true);
		expect(shouldRunDirectImplementationAdvice("What can you add right now?")).toBe(true);
		expect(shouldRunDirectImplementationAdvice("Explain the evidence pack")).toBe(false);
	});

	it("answers with a concrete product capability", async () => {
		let completed = "";
		const result = await runDirectImplementationAdvice({
			onComplete: (fullText) => {
				completed = fullText;
			},
		});

		expect(result.fullText).toContain("interactive Remediation Queue");
		expect(result.fullText).toContain("SLA due dates");
		expect(completed).toBe(result.fullText);
	});
});
