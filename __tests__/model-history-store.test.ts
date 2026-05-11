import { describe, expect, it } from "bun:test";
import { ModelHistoryStore } from "../src/state/model-history-store";

describe("ModelHistoryStore", () => {
	it("sanitizes leaked assistant protocol text on set and append", () => {
		const store = new ModelHistoryStore();

		store.set([
			{ role: "user", content: "One" },
			{ role: "assistant", content: '<tool-input name="runBash">{"command":"Get-Process"}</tool-input>' },
		]);

		expect(store.get()).toEqual([{ role: "user", content: "One" }]);

		store.appendTurn("Two", [
			{
				role: "assistant",
				content: '{"function_call":{"name":"webSearch","arguments":"{\\"query\\":\\"x\\"}"}}',
			},
		]);

		expect(store.get()).toEqual([
			{ role: "user", content: "One" },
			{ role: "user", content: "Two" },
		]);
	});
});
