import { describe, expect, it } from "bun:test";
import {
	runDirectTurnExplanation,
	shouldRunDirectTurnExplanation,
} from "../src/ai/direct-turn-explanation-runner";
import type { ModelMessage, StreamCallbacks } from "../src/types";

describe("direct turn explanation runner", () => {
	const leakedTodoHistory: ModelMessage[] = [
		{ role: "user", content: "Well, that's good." },
		{
			role: "assistant",
			content:
				'{"action":"write","todos":{"content":"Apply principle of least privilege","status":"pending"}}',
		},
	];

	it("routes meta questions about the previous action away from web/model tools", () => {
		expect(shouldRunDirectTurnExplanation("What did you do there?", leakedTodoHistory)).toBe(true);
		expect(shouldRunDirectTurnExplanation("What was that?", leakedTodoHistory)).toBe(true);
		expect(shouldRunDirectTurnExplanation("Run a scan", leakedTodoHistory)).toBe(false);
	});

	it("explains leaked todo JSON as an internal planning failure", async () => {
		let final = "";
		const callbacks: StreamCallbacks = {
			onComplete: (text) => {
				final = text;
			},
		};

		await runDirectTurnExplanation(leakedTodoHistory, callbacks);

		expect(final).toContain("internal todo/planning item");
		expect(final).toContain("No Windows security settings were changed");
		expect(final).not.toContain("signal security feature comparison");
	});
});
