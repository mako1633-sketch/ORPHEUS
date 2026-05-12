import { tool } from "ai";
import { z } from "zod";
import {
	addExecutiveItem,
	buildExecutiveBriefing,
	listExecutiveItems,
	updateExecutiveItem,
} from "../executive-state";

const kindSchema = z.enum(["priority", "follow_up", "decision", "waiting_on", "risk", "note"]);
const statusSchema = z.enum(["open", "done", "blocked", "archived"]);

export const executiveAssistant = tool({
	description:
		"Executive-assistant workbench for durable priorities, follow-ups, decisions, waiting-on items, risks, and concise briefings. Use it when the user asks ORPHEUS to remember commitments, track what needs attention, prepare a briefing, act like an executive assistant, or maintain JARVIS-style situational awareness.",
	inputSchema: z.discriminatedUnion("action", [
		z.object({
			action: z.literal("capture"),
			kind: kindSchema,
			title: z.string().min(1).describe("Concise item title."),
			dueAt: z.string().optional().describe("Optional due date/time as ISO or natural text."),
			owner: z.string().optional().describe("Optional person responsible or waited on."),
			context: z.string().optional().describe("Useful context, source detail, or next action."),
			source: z.string().optional().describe("Where this came from, such as chat, meeting, repo, or note."),
			status: statusSchema.optional().default("open"),
		}),
		z.object({
			action: z.literal("list"),
			kind: kindSchema.optional(),
			status: statusSchema.optional(),
			limit: z.number().int().min(1).max(80).optional().default(20),
		}),
		z.object({
			action: z.literal("update"),
			id: z.string().min(1),
			status: statusSchema.optional(),
			title: z.string().optional(),
			dueAt: z.string().optional(),
			owner: z.string().optional(),
			context: z.string().optional(),
		}),
		z.object({
			action: z.literal("briefing"),
		}),
	]),
	execute: async (input) => {
		if (input.action === "capture") {
			return {
				success: true,
				action: "capture",
				...(await addExecutiveItem(input)),
			};
		}

		if (input.action === "list") {
			return {
				success: true,
				action: "list",
				items: await listExecutiveItems(input),
			};
		}

		if (input.action === "update") {
			const result = await updateExecutiveItem(input);
			return {
				success: result.found,
				action: "update",
				...result,
				error: result.found ? undefined : `Executive item '${input.id}' was not found.`,
			};
		}

		return {
			success: true,
			action: "briefing",
			briefing: await buildExecutiveBriefing(),
		};
	},
});
