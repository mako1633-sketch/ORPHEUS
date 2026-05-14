import { tool } from "ai";
import { z } from "zod";
import {
	appendPersistentContext,
	clearPersistentContext,
	exportPersistentContext,
	loadPersistentContext,
	savePersistentContext,
} from "../persistent-context";

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
		z.object({
			action: z.literal("clear"),
		}),
		z.object({
			action: z.literal("export"),
		}),
	]),
	execute: async (input) => {
		if (input.action === "read") {
			const content = await loadPersistentContext();
			const lines = content
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter(Boolean);
			return {
				success: true,
				action: "read",
				content,
				empty: content.length === 0,
				controlCenter: {
					lineCount: lines.length,
					charCount: content.length,
					preview: lines.slice(0, 12),
					actions: ["append", "replace", "clear", "export"],
				},
			};
		}

		if (input.action === "clear") {
			return {
				success: true,
				action: "clear",
				...(await clearPersistentContext()),
			};
		}

		if (input.action === "export") {
			return {
				success: true,
				action: "export",
				...(await exportPersistentContext()),
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
