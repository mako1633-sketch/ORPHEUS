import { tool } from "ai";
import { z } from "zod";
import { appendPersistentContext, loadPersistentContext, savePersistentContext } from "../persistent-context";

export const persistentContext = tool({
	description:
		"Read or update local ORPHEUS context that persists across sessions. Use this for durable preferences, project facts, setup decisions, and other information the user explicitly wants ORPHEUS to remember without relying on cloud memory.",
	inputSchema: z.discriminatedUnion("action", [
		z.object({
			action: z.literal("read"),
		}),
		z.object({
			action: z.literal("append"),
			content: z.string().min(1).describe("A concise durable fact or preference to remember."),
		}),
		z.object({
			action: z.literal("replace"),
			content: z.string().describe("The complete persistent context content to store."),
		}),
	]),
	execute: async (input) => {
		if (input.action === "read") {
			const content = await loadPersistentContext();
			return {
				success: true,
				action: "read",
				content,
				empty: content.length === 0,
			};
		}

		const result =
			input.action === "append"
				? await appendPersistentContext(input.content)
				: await savePersistentContext(input.content);

		return {
			success: true,
			action: input.action,
			...result,
		};
	},
});
