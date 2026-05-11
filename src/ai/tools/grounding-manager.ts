import { tool } from "ai";
import { z } from "zod";
import { daemonEvents } from "../../state/daemon-events";
import { getRuntimeContext } from "../../state/runtime-context";
import { loadLatestGroundingMap, saveGroundingMap } from "../../state/session-store";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonString(value: unknown): unknown {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return value;
	}
}

function getStringField(record: UnknownRecord, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string") return value;
	}
	return undefined;
}

function deriveTextFragment(quote: string): string {
	return quote.trim().slice(0, 150);
}

function normalizeGroundedStatement(item: unknown): unknown {
	if (!isRecord(item)) return item;

	const rawSource = isRecord(item.source) ? item.source : {};
	const statement = getStringField(item, ["statement", "claim", "text"]);
	const quote = getStringField(rawSource, ["quote", "text", "excerpt"]);
	const textFragment =
		getStringField(rawSource, ["textFragment", "fragment", "fragmentText"]) ??
		(quote ? deriveTextFragment(quote) : undefined);
	const source = {
		...rawSource,
		url: getStringField(rawSource, ["url", "href", "link"]),
		quote,
		textFragment,
	};

	return {
		...item,
		statement,
		source,
	};
}

function normalizeGroundingItems(value: unknown): unknown {
	const parsed = parseJsonString(value);
	if (!Array.isArray(parsed)) return parsed;
	return parsed.map(normalizeGroundedStatement);
}

function normalizeGroundingInput(value: unknown): unknown {
	const parsed = parseJsonString(value);
	if (!isRecord(parsed)) return parsed;

	return {
		...parsed,
		items: normalizeGroundingItems(parsed.items),
	};
}

const groundingSourceSchema = z.object({
	url: z.string().url().describe("The source URL where the information was found."),
	quote: z
		.string()
		.min(1)
		.max(300)
		.describe("A short excerpt (1-2 sentences) from the source that supports the statement."),
	textFragment: z
		.string()
		.min(1)
		.max(150)
		.describe(
			"A short phrase or subphrase (MUST BE COPIED VERBATIM) from the source text for deep-linking. Max 150 characters."
		),
});

const groundedStatementSchema = z.object({
	id: z.string().min(1).describe("Unique identifier for this grounding (e.g., 'g1', 'g2')."),
	statement: z.string().min(1).describe("The factual claim being grounded."),
	source: groundingSourceSchema.describe("The source backing this statement."),
});

const groundedStatementItemsArraySchema = z
	.array(groundedStatementSchema)
	.min(1)
	.describe(
		"Array of grounded statements. Each item has an id, a statement (the claim), and a source (URL, quote, and optional text fragment)."
	);

// Some models stringify arrays or use nearby field names. Normalize those
// recoverable shapes while still requiring real source evidence.
export const groundingItemsSchema = z
	.preprocess(normalizeGroundingItems, groundedStatementItemsArraySchema)
	.describe(
		"Array of grounded statements, or a JSON string containing that array. Each item has an id, statement, and source."
	);

export const groundingManagerInputSchema = z.preprocess(
	normalizeGroundingInput,
	z.object({
		action: z
			.enum(["set", "append"])
			.describe("Action to perform: 'set' replaces all groundings, 'append' adds to existing ones."),
		items: groundingItemsSchema,
	})
);

export const groundingManager = tool({
	description:
		"Manage the list of grounded statements (facts supported by sources) for the current session. " +
		"You can 'set' (overwrite) the entire list or 'append' new items to the existing list. " +
		"Use this to maintain a persistent list of verified claims and their sources.",
	inputSchema: groundingManagerInputSchema,
	execute: async ({ action, items }) => {
		const context = getRuntimeContext();

		if (!context.sessionId) {
			return {
				success: false,
				error: "No active session for grounding",
			};
		}

		try {
			let finalItems = items;

			if (action === "append") {
				const existingMap = await loadLatestGroundingMap(context.sessionId);
				if (existingMap) {
					finalItems = [...existingMap.items, ...items];
				}
			}

			const groundingMap = await saveGroundingMap(context.sessionId, context.messageId, finalItems);

			daemonEvents.emit("groundingSaved", context.sessionId, context.messageId, groundingMap.id);

			return {
				success: true,
				action,
				addedCount: items.length,
				totalCount: finalItems.length,
				currentItems: finalItems,
			};
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			return {
				success: false,
				error: err.message,
			};
		}
	},
});
