import type { ModelMessage } from "ai";

export interface AssistantResponseGuardResult {
	fullText: string;
	finalText?: string;
	responseMessages: ModelMessage[];
	replaced: boolean;
	reason?: "tool-json" | "internal-instructions" | "unsupported-coding-claim";
}

const TOOL_PROTOCOL_KEY_PATTERN =
	/"(?:tool_calls?|tool_call_id|toolCallId|function_call|arguments|toolName|tool_name|action)"\s*:/i;
const TOOL_INPUT_TAG_PATTERN = /<\/?(?:tool-input|tool_call|function-call|function_call)\b/i;
const GUARDED_RESPONSE_NOTICE_PATTERN =
	/\bI exposed an internal tool call instead of answering you directly\b|\bI got off track and exposed internal operating instructions\b|\bI hit a routing glitch\b/i;

const TOOL_NAME_ALTERNATION =
	"todoManager|groundingManager|runBash|windowsSecurity|windowsHardening|signal|webSearch|subagent";
const TOOL_NAME_PATTERN = new RegExp(`^(?:${TOOL_NAME_ALTERNATION})$`, "i");

const TOOL_JSON_INTENT_PATTERNS = [
	/\bHere\s+is\s+the\s+JSON\s+for\s+(?:this\s+)?tool\b/i,
	/\bI(?:'ll| will)\s+provide\s+(?:a\s+)?JSON\s+object\b/i,
	/\bHere(?:'s| is)\s+the\s+final\s+step\b[\s\S]*?"action"\s*:/i,
	/\bI\s+would\s+use\s+the\s+\w+\s+tool\b/i,
	/\buse\s+the\s+\w+\s+tool\b/i,
];

const INTERNAL_INSTRUCTION_PATTERNS = [
	/\bBased on the provided instructions and tool capabilities\b/i,
	/\bhere is a step-by-step guide to handling the user request\b/i,
	/\bHere(?:'s| is)\s+(?:an\s+)?example\s+of\s+(?:a\s+)?(?:subagent|tool call|tool invocation|execution request)\b/i,
	/\bHere(?:'s| is)\s+the\s+subagent\s+execution\s+and\s+grounding\s+details\b/i,
	/\bBelow\s+is\s+an\s+example\s+of\s+what\s+the\s+subagent\s+execution\s+response\s+might\s+look\s+like\b/i,
	/\bIf you are missing any tools,\s*API keys,\s*or other required resources\b/i,
	/\bAlways report the correct file location to the user when writing a file using writeFile\b/i,
	/\bReview the user request and identify the task at hand\b/i,
];

const CODING_REQUEST_PATTERN =
	/\b(code|coding|program|programming|debug|bug|fix|patch|implement|repo|repository|typescript|javascript|python|build|test|lint|typecheck|cli|api|ui|component)\b/i;
const CODING_COMPLETION_CLAIM_PATTERN =
	/\b(done|implemented|fixed|patched|updated|changed|wired|landed|completed|rebuilt|refactored)\b/i;
const CODING_EVIDENCE_PATTERN =
	/\b(test(?:ed|s)?|typecheck|lint|format(?:ted|:check)?|check(?:ed)?|verified|validated|readback|passed|failed|could not run|not run|diff|files changed|build(?:s|t)?|compiled|no fixes applied)\b/i;
const CODING_TOOL_NAMES = new Set(["codingWorkbench", "writeFile", "runBash", "readFile", "projectContext"]);

function textFromMessage(message: ModelMessage): string {
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content
		.map((part) => {
			if (part && typeof part === "object" && "type" in part && part.type === "text") {
				return "text" in part && typeof part.text === "string" ? part.text : "";
			}
			return "";
		})
		.join("");
}

function messageHasCodingToolEvidence(message: ModelMessage): boolean {
	if (!Array.isArray(message.content)) return false;
	return message.content.some((part) => {
		if (!part || typeof part !== "object") return false;
		if (!("type" in part)) return false;
		const record = part as Record<string, unknown>;
		const toolName = record.toolName;
		return typeof toolName === "string" && CODING_TOOL_NAMES.has(toolName);
	});
}

function hasCodingToolEvidence(messages: ModelMessage[]): boolean {
	return messages.some(messageHasCodingToolEvidence);
}

function shouldGuardUnsupportedCodingClaim(params: {
	text: string;
	userText: string;
	responseMessages: ModelMessage[];
}): boolean {
	const text = params.text.trim();
	if (!text) return false;
	if (!CODING_REQUEST_PATTERN.test(params.userText)) return false;
	if (!CODING_COMPLETION_CLAIM_PATTERN.test(text)) return false;
	if (CODING_EVIDENCE_PATTERN.test(text)) return false;
	if (hasCodingToolEvidence(params.responseMessages)) return false;
	return true;
}

function hasToolProtocolShape(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	if (Array.isArray(value)) return value.some(hasToolProtocolShape);

	const record = value as Record<string, unknown>;
	const keys = new Set(Object.keys(record));

	if (
		keys.has("tool_calls") ||
		keys.has("tool_call") ||
		keys.has("function_call") ||
		keys.has("toolCallId") ||
		keys.has("tool_call_id")
	) {
		return true;
	}

	const hasToolName = keys.has("toolName") || keys.has("tool_name") || keys.has("name");
	const toolNameValue = record.toolName ?? record.tool_name ?? record.name;
	const hasToolArgs =
		keys.has("arguments") ||
		keys.has("args") ||
		keys.has("input") ||
		keys.has("parameters") ||
		keys.has("toolCallId") ||
		keys.has("tool_call_id");
	if (
		hasToolName &&
		hasToolArgs &&
		(typeof toolNameValue !== "string" || TOOL_NAME_PATTERN.test(toolNameValue))
	) {
		return true;
	}

	const hasAction = keys.has("action");
	const hasToolLikePayload = [...keys].some((key) =>
		/^(todos?|items?|requests?|questions?|command|account|recipient|groupId|source|statement|path|content|playbook|save|task)$/i.test(
			key
		)
	);
	if (hasAction && hasToolLikePayload) return true;

	const DATA_PAYLOAD_KEYS = new Set(["input", "output", "result", "data", "args", "parameters"]);
	return Object.entries(record).some(
		([key, val]) => !DATA_PAYLOAD_KEYS.has(key) && hasToolProtocolShape(val)
	);
}

function parseJsonObjectLike(text: string): unknown {
	const trimmed = text.trim();
	const withoutSpeaker = trimmed.replace(/^(?:ORPHEUS|DAEMON):\s*/i, "");
	if (!withoutSpeaker.startsWith("{") && !withoutSpeaker.startsWith("[")) return undefined;
	try {
		return JSON.parse(withoutSpeaker);
	} catch {
		return undefined;
	}
}

function getJsonFenceContents(text: string): string[] {
	const contents: string[] = [];
	const fencePattern = /```(?:json|javascript|js)?\s*([\s\S]*?)```/gi;
	for (const match of text.matchAll(fencePattern)) {
		if (match[1]?.trim()) contents.push(match[1]);
	}
	return contents;
}

function getJsonObjectCandidates(text: string): string[] {
	const candidates: string[] = [];
	for (let start = 0; start < text.length; start++) {
		const open = text[start];
		if (open !== "{" && open !== "[") continue;

		const close = open === "{" ? "}" : "]";
		let depth = 0;
		let inString = false;
		let escaped = false;

		for (let index = start; index < text.length; index++) {
			const char = text[index];
			if (escaped) {
				escaped = false;
				continue;
			}
			if (char === "\\") {
				escaped = inString;
				continue;
			}
			if (char === '"') {
				inString = !inString;
				continue;
			}
			if (inString) continue;
			if (char === open) depth++;
			if (char === close) depth--;
			if (depth === 0) {
				candidates.push(text.slice(start, index + 1));
				start = index;
				break;
			}
		}
	}
	return candidates;
}

function containsToolProtocolJson(text: string): boolean {
	const whole = parseJsonObjectLike(text);
	if (hasToolProtocolShape(whole)) return true;

	for (const fenced of getJsonFenceContents(text)) {
		if (hasToolProtocolShape(parseJsonObjectLike(fenced))) return true;
	}

	if (
		!TOOL_PROTOCOL_KEY_PATTERN.test(text) &&
		!TOOL_JSON_INTENT_PATTERNS.some((pattern) => pattern.test(text))
	) {
		return false;
	}

	return getJsonObjectCandidates(text).some((candidate) =>
		hasToolProtocolShape(parseJsonObjectLike(candidate))
	);
}

export function detectAssistantResponseLeak(text: string): AssistantResponseGuardResult["reason"] | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	if (TOOL_INPUT_TAG_PATTERN.test(trimmed) || containsToolProtocolJson(trimmed)) {
		return "tool-json";
	}
	if (INTERNAL_INSTRUCTION_PATTERNS.some((pattern) => pattern.test(trimmed))) {
		return "internal-instructions";
	}
	return null;
}

export function isAssistantResponseGuardNotice(text: string): boolean {
	return GUARDED_RESPONSE_NOTICE_PATTERN.test(text.trim());
}

export function buildAssistantResponseLeakReplacement(
	reason: AssistantResponseGuardResult["reason"],
	userText: string
): string {
	const normalizedUserText = userText.trim();
	const wantsImmediateImplementation =
		/\bwhat\s+can\s+you\s+implement\s+right\s+now\b/i.test(normalizedUserText) ||
		/\bwhat\s+can\s+be\s+implemented\s+right\s+now\b/i.test(normalizedUserText);

	if (wantsImmediateImplementation) {
		return [
			"I hit a routing glitch. Here is the useful answer:",
			"",
			"I can implement a real client remediation command center right now: show open findings, SLA due dates, overdue items, accepted-risk reviews, evidence links, and one-click scheduled task templates from the ORPHEUS evidence pack flow.",
			"",
			"The highest-value next piece is an interactive Remediation Queue inside the terminal, because it turns the report from a file path into work the operator can act on immediately.",
		].join("\n");
	}

	if (reason === "tool-json") {
		return (
			"I hit a routing glitch and blocked an invalid internal action before it reached the system. " +
			"No Windows settings, files, Signal messages, todos, or security changes were made from that text. " +
			(normalizedUserText ? `Continuing plainly: ${normalizedUserText}` : "Continuing plainly from here.")
		);
	}

	if (reason === "unsupported-coding-claim") {
		return (
			"I should not call that done without evidence. I need to verify the change with a concrete check, " +
			"or clearly say what could not be validated."
		);
	}

	return (
		"I hit a routing glitch and blocked an internal draft before it reached the system. " +
		"No action was completed from that response. Continuing plainly from your actual request."
	);
}

function removeLeakedAssistantTextFromMessages(messages: ModelMessage[]): ModelMessage[] {
	const next: ModelMessage[] = [];

	for (const message of messages) {
		if (message.role !== "assistant") {
			next.push(message);
			continue;
		}
		const text = textFromMessage(message);
		if (!detectAssistantResponseLeak(text) && !isAssistantResponseGuardNotice(text)) {
			next.push(message);
			continue;
		}

		if (!Array.isArray(message.content)) {
			continue;
		}

		const content = message.content.filter((part) => {
			if (!part || typeof part !== "object") return true;
			if (!("type" in part) || part.type !== "text") return true;
			const partText = "text" in part && typeof part.text === "string" ? part.text : "";
			return !detectAssistantResponseLeak(partText) && !isAssistantResponseGuardNotice(partText);
		});

		if (content.length > 0) {
			next.push({ ...message, content } as ModelMessage);
		}
	}

	return next;
}

export function sanitizeAssistantMessagesForModelHistory(messages: ModelMessage[]): ModelMessage[] {
	return removeLeakedAssistantTextFromMessages(messages);
}

export function guardAssistantResponse(params: {
	fullText: string;
	finalText?: string;
	responseMessages: ModelMessage[];
	userText: string;
}): AssistantResponseGuardResult {
	const text = params.finalText ?? params.fullText;
	const reason =
		detectAssistantResponseLeak(text) ??
		(shouldGuardUnsupportedCodingClaim({
			text,
			userText: params.userText,
			responseMessages: params.responseMessages,
		})
			? "unsupported-coding-claim"
			: null);
	if (!reason) {
		return {
			fullText: params.fullText,
			finalText: params.finalText,
			responseMessages: params.responseMessages,
			replaced: false,
		};
	}

	const replacement = buildAssistantResponseLeakReplacement(reason, params.userText);
	return {
		fullText: replacement,
		finalText: replacement,
		responseMessages: removeLeakedAssistantTextFromMessages(params.responseMessages),
		replaced: true,
		reason,
	};
}
