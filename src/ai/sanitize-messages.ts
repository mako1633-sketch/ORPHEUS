import type { ModelMessage } from "ai";

/**
 * Output-only fields that cannot be round-tripped back to providers.
 *
 * - `providerOptions`: AI SDK / provider layer metadata
 * - `reasoning`: Anthropic extended thinking raw response field
 * - `reasoning_details`: Anthropic extended thinking block details
 *
 * Note: Content parts with `type: "reasoning"` are preserved; these are
 * different from the message-level fields stripped here.
 */
const OUTPUT_ONLY_FIELDS = new Set(["providerOptions", "reasoning", "reasoning_details"]);

/**
 * Known content-part type values where we should strip output-only fields
 * from the part object itself (but NOT from nested payloads like tool inputs).
 */
const KNOWN_CONTENT_PART_TYPES = new Set([
	"tool-call",
	"tool-result",
	"text",
	"reasoning",
	"image",
	"file",
	"source",
]);

/**
 * Remove output-only metadata from a value, stopping at content-part
 * boundaries. Tool-call inputs and tool-result outputs are left intact
 * because they may contain arbitrary keys that should not be stripped.
 */
function removeOutputOnlyFieldsShallow(obj: unknown): unknown {
	if (obj === null || obj === undefined) return obj;
	if (Array.isArray(obj)) {
		return obj.map(removeOutputOnlyFieldsShallow).filter((value) => value !== undefined);
	}
	if (typeof obj === "object") {
		const record = obj as Record<string, unknown>;

		// If this is a known content-part type, only strip output-only fields
		// from the part object itself — do not recurse into its nested payloads.
		if (
			"type" in record &&
			typeof record.type === "string" &&
			KNOWN_CONTENT_PART_TYPES.has(record.type)
		) {
			const result: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(record)) {
				if (OUTPUT_ONLY_FIELDS.has(key)) continue;
				result[key] = value;
			}
			return result;
		}

		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(record)) {
			if (OUTPUT_ONLY_FIELDS.has(key)) continue;
			const cleaned = removeOutputOnlyFieldsShallow(value);
			if (cleaned !== undefined) {
				result[key] = cleaned;
			}
		}
		return result;
	}
	return obj;
}

function stripWhitespaceOnlyTextParts(content: unknown): unknown {
	if (!Array.isArray(content)) return content;

	return content.filter((part) => {
		if (!part || typeof part !== "object" || !("type" in part)) return true;

		// Some providers emit standalone newline-only text parts between tool calls.
		// These don't render well in the UI (and add noise to stored sessions), so drop them.
		if ((part as { type?: unknown }).type === "text") {
			const text = (part as { text?: unknown }).text;
			if (typeof text === "string" && text.trim().length === 0) return false;
		}

		return true;
	});
}

/**
 * Sanitize response messages for use as input in subsequent API calls and for UI storage.
 *
 * - Removes `providerOptions` and other output-only metadata from message and
 *   content-part level, but preserves nested payloads (e.g. tool-call inputs)
 * - Drops whitespace-only `text` parts (e.g. `"\n"`) that otherwise become invisible UI blocks
 */
export function sanitizeMessagesForInput(messages: ModelMessage[]): ModelMessage[] {
	const cleaned = removeOutputOnlyFieldsShallow(messages) as ModelMessage[];

	return cleaned.map((msg) => {
		// Keep system messages untouched: AI SDK requires system content to be a string.
		if (msg.role === "system") return msg;

		// Only strip when content is an array (parts-based format).
		if (Array.isArray((msg as { content?: unknown }).content)) {
			return {
				...(msg as unknown as Record<string, unknown>),
				content: stripWhitespaceOnlyTextParts((msg as { content?: unknown }).content),
			} as ModelMessage;
		}

		return msg;
	});
}
