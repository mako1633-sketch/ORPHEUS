import { describe, expect, it } from "bun:test";
import { todoManagerInputSchema } from "../src/ai/tools/todo-manager";

describe("todoManager input schema", () => {
	it("accepts a structured todo array", () => {
		const parsed = todoManagerInputSchema.parse({
			action: "write",
			todos: [{ content: "Improve coding abilities", status: "pending" }],
		});

		expect(parsed.todos?.[0]?.content).toBe("Improve coding abilities");
	});

	it("accepts a JSON-stringified todo array", () => {
		const parsed = todoManagerInputSchema.parse({
			action: "write",
			todos: JSON.stringify([
				{ content: "Improve coding abilities", status: "pending" },
				{ content: "Explore Windows security options", status: "in_progress" },
			]),
		});

		expect(parsed.todos).toEqual([
			{ content: "Improve coding abilities", status: "pending" },
			{ content: "Explore Windows security options", status: "in_progress" },
		]);
	});

	it("accepts common todo wrappers and content aliases", () => {
		const parsed = todoManagerInputSchema.parse({
			action: "set",
			todos: {
				tasks: [
					{ task: "Inspect failing tool call", status: "in-progress" },
					{ title: "Add regression coverage", status: "done" },
				],
			},
		});

		expect(parsed).toEqual({
			action: "write",
			todos: [
				{ content: "Inspect failing tool call", status: "in_progress" },
				{ content: "Add regression coverage", status: "completed" },
			],
		});
	});

	it("accepts a JSON-stringified object wrapper", () => {
		const parsed = todoManagerInputSchema.parse({
			action: "write",
			todos: JSON.stringify({
				items: [{ text: "Normalize todo inputs", status: "current" }],
			}),
		});

		expect(parsed.todos).toEqual([{ content: "Normalize todo inputs", status: "in_progress" }]);
	});

	it("accepts simple string todo arrays", () => {
		const parsed = todoManagerInputSchema.parse({
			action: "write",
			todos: ["Trace parser", "Patch terminal layout"],
		});

		expect(parsed.todos).toEqual([
			{ content: "Trace parser", status: "pending" },
			{ content: "Patch terminal layout", status: "pending" },
		]);
	});

	it("coerces update index and status aliases", () => {
		const parsed = todoManagerInputSchema.parse({
			action: "change",
			index: "2",
			status: "finished",
		});

		expect(parsed).toEqual({
			action: "update",
			index: 2,
			status: "completed",
		});
	});
});
