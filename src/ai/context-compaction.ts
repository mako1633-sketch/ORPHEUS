import type { ModelMessage } from "../types";
import { sanitizeMessagesForInput } from "./sanitize-messages";

const DEFAULT_MAX_CONTEXT_CHARS = 64000;
const DEFAULT_MAX_MESSAGE_CHARS = 12000;

type CompactOptions = {
	maxContextChars?: number;
	maxMessageChars?: number;
};

function truncateText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	if (maxChars <= 32) return text.slice(0, maxChars);
	return `${text.slice(0, maxChars - 32)}\n...[truncated for context]`;
}

function stringifyCompact(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function extractTextFromContent(content: unknown, maxChars: number): string {
	if (typeof content === "string") return truncateText(content, maxChars);
	if (!Array.isArray(content)) return truncateText(stringifyCompact(content), maxChars);

	const parts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") {
			const text = stringifyCompact(part);
			if (text) parts.push(text);
			continue;
		}

		const record = part as Record<string, unknown>;
		const type = typeof record.type === "string" ? record.type : "";

		if (type === "text" || type === "reasoning") {
			const text = typeof record.text === "string" ? record.text : stringifyCompact(record);
			if (text.trim()) parts.push(text);
		} else if (type === "tool-call" || type === "tool-result") {
			continue;
		} else {
			const text = stringifyCompact(record);
			if (text) parts.push(text);
		}
	}

	return truncateText(parts.join("\n").trim(), maxChars);
}

function compactMessage(message: ModelMessage, maxMessageChars: number): ModelMessage | null {
	if (message.role === "tool") {
		return null;
	}

	const content = extractTextFromContent((message as { content?: unknown }).content, maxMessageChars).trim();
	if (!content) return null;

	return {
		role: message.role,
		content,
	} as ModelMessage;
}

function measureMessage(message: ModelMessage): number {
	return JSON.stringify(message).length;
}

export function compactModelHistoryForContext(
	messages: ModelMessage[],
	options: CompactOptions = {}
): ModelMessage[] {
	const maxContextChars = options.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
	const maxMessageChars = options.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS;
	const sanitized = sanitizeMessagesForInput(messages);

	const selected: ModelMessage[] = [];
	let usedChars = 0;
	let omitted = 0;

	for (let i = sanitized.length - 1; i >= 0; i -= 1) {
		const compacted = compactMessage(sanitized[i]!, maxMessageChars);
		if (!compacted) {
			omitted += 1;
			continue;
		}

		const messageChars = measureMessage(compacted);
		if (selected.length > 0 && usedChars + messageChars > maxContextChars) {
			omitted = i + 1;
			break;
		}

		selected.push(compacted);
		usedChars += messageChars;
	}

	selected.reverse();

	if (omitted > 0) {
		selected.unshift({
			role: "system",
			content: `Earlier conversation was compacted: ${omitted} older message${omitted === 1 ? "" : "s"} were summarized out of the prompt to stay within context limits. Rely on recent messages and durable ORPHEUS task state; do not mention this compaction note to the user.`,
		} as ModelMessage);
	}

	return selected;
}
