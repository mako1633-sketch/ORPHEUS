import { tool } from "ai";
import { z } from "zod";
import {
	addExecutiveItem,
	buildExecutiveBriefing,
	listExecutiveItems,
	updateExecutiveItem,
} from "../executive-state";
import { getRuntimeContext } from "../../state/runtime-context";
import {
	listTaskStackItems,
	popNextTaskStackItem,
	pushTaskStackItem,
	updateTaskStackItem,
} from "../task-stack-state";
import { getHonchoManager, isHonchoAvailable } from "../memory/honcho-manager";

const kindSchema = z.enum(["priority", "follow_up", "decision", "waiting_on", "risk", "note"]);
const statusSchema = z.enum(["open", "done", "blocked", "archived"]);
const taskStatusSchema = z.enum(["queued", "active", "blocked", "done", "archived"]);
const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);

async function mirrorTaskStackChangeToHoncho(summary: string): Promise<void> {
	if (!isHonchoAvailable()) return;
	const runtimeContext = getRuntimeContext();
	await getHonchoManager().addTurn({
		sessionId: runtimeContext.sessionId,
		userText: "ORPHEUS task stack update",
		assistantText: summary,
		metadata: {
			source: "task-stack",
			timestamp: new Date().toISOString(),
		},
	});
}

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
		z.object({
			action: z.literal("stackPush"),
			title: z.string().min(1),
			priority: prioritySchema.optional().default("normal"),
			context: z.string().optional(),
			nextStep: z.string().optional(),
			owner: z.string().optional(),
			dueAt: z.string().optional(),
			source: z.string().optional(),
		}),
		z.object({
			action: z.literal("stackList"),
			status: taskStatusSchema.optional(),
			limit: z.number().int().min(1).max(80).optional().default(30),
		}),
		z.object({
			action: z.literal("stackUpdate"),
			id: z.string().min(1),
			status: taskStatusSchema.optional(),
			priority: prioritySchema.optional(),
			title: z.string().optional(),
			context: z.string().optional(),
			nextStep: z.string().optional(),
			owner: z.string().optional(),
			dueAt: z.string().optional(),
		}),
		z.object({
			action: z.literal("stackPop"),
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

		if (input.action === "stackPush") {
			const result = await pushTaskStackItem(input);
			await mirrorTaskStackChangeToHoncho(
				`Task stacked: ${result.item.title}. Priority: ${result.item.priority}. Next step: ${
					result.item.nextStep ?? "not set"
				}.`
			);
			return {
				success: true,
				action: "stackPush",
				...result,
			};
		}

		if (input.action === "stackList") {
			return {
				success: true,
				action: "stackList",
				items: await listTaskStackItems(input),
			};
		}

		if (input.action === "stackUpdate") {
			const result = await updateTaskStackItem(input);
			if (result.item) {
				await mirrorTaskStackChangeToHoncho(
					`Task stack updated: ${result.item.title}. Status: ${result.item.status}. Next step: ${
						result.item.nextStep ?? "not set"
					}.`
				);
			}
			return {
				success: result.found,
				action: "stackUpdate",
				...result,
				error: result.found ? undefined : `Task stack item '${input.id}' was not found.`,
			};
		}

		if (input.action === "stackPop") {
			const result = await popNextTaskStackItem();
			if (result.item) {
				await mirrorTaskStackChangeToHoncho(
					`Task activated from stack: ${result.item.title}. Next step: ${result.item.nextStep ?? "not set"}.`
				);
			}
			return {
				success: Boolean(result.item),
				action: "stackPop",
				...result,
				error: result.item ? undefined : "No queued or blocked task stack item is available.",
			};
		}

		return {
			success: true,
			action: "briefing",
			briefing: await buildExecutiveBriefing(),
		};
	},
});
