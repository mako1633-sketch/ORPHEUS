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
});
