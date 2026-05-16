import type { ModelMessage } from "ai";

const SHORT_REPLY_PATTERN =
	/^(yes|yes please|yeah|yep|sure|please do|do it|continue|go ahead|proceed|please proceed|(please\s+)?proceed with (it|that|this|those|these tasks?|the tasks?)|(please\s+)?run (it|that|this|those|these tasks?|the tasks?)|(please\s+)?start (it|that|this|those|these tasks?|the tasks?)|ok|okay|no|nope|not that|that one|this one|those|these|both|all|both of them|all of them|these tasks?|the tasks?|option\s+\d+|#?\d+(?:\s*(?:,|and)\s*#?\d+)*)$/i;
const SELECTION_PATTERN = /^(?:option\s+)?#?\d+(?:\s*(?:,|and)\s*(?:option\s+)?#?\d+)*$/i;
const NUMBERED_PROMPT_PATTERN = /^\s*(\d+)[.)]\s*(.+?)\s*$/gm;
const SUGGESTED_FOLLOW_UP_SECTION_PATTERN =
	/##\s*Suggested Follow-up Prompts\s*\n([\s\S]*?)(?=\n##\s+|$)/i;

function messageContentToText(message: ModelMessage): string {
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";

	const parts: string[] = [];
	for (const part of message.content) {
		if (!part || typeof part !== "object") continue;
		if ("type" in part && part.type === "text" && "text" in part && typeof part.text === "string") {
			parts.push(part.text);
		}
	}
	return parts.join("").trim();
}

export function isShortContextualReply(userText: string): boolean {
	const normalized = userText
		.trim()
		.replace(/\s+/g, " ")
		.replace(/[.!?]+$/g, "");
	if (!normalized || normalized.length > 80) return false;
	return SHORT_REPLY_PATTERN.test(normalized);
}

export function getLastAssistantText(conversationHistory: ModelMessage[]): string | null {
	for (let i = conversationHistory.length - 1; i >= 0; i--) {
		const message = conversationHistory[i];
		if (!message || message.role !== "assistant") continue;
		const text = messageContentToText(message).trim();
		if (text) return text;
	}
	return null;
}

function parseNumberedPromptLine(line: string): string {
	const labelPromptMatch = line.match(/^[^:]{1,80}:\s*(.+)$/);
	return (labelPromptMatch?.[1] ?? line).trim();
}

function getSelectionNumbers(userText: string): number[] {
	const normalized = userText
		.trim()
		.replace(/\s+/g, " ")
		.replace(/[.!?]+$/g, "");
	if (!SELECTION_PATTERN.test(normalized)) return [];
	return (normalized.match(/\d+/g) ?? [])
		.map((value) => Number(value))
		.filter((value) => Number.isSafeInteger(value) && value > 0);
}

function getSuggestedFollowUpSection(text: string): string | null {
	return text.match(SUGGESTED_FOLLOW_UP_SECTION_PATTERN)?.[1]?.trim() ?? null;
}

export function resolveNumberedFollowUpPrompt(
	userText: string,
	conversationHistory: ModelMessage[]
): string | null {
	const selectedNumbers = getSelectionNumbers(userText);
	if (selectedNumbers.length === 0) return null;

	const lastAssistantText = getLastAssistantText(conversationHistory);
	if (!lastAssistantText) return null;
	const followUpSection = getSuggestedFollowUpSection(lastAssistantText);
	if (!followUpSection) return null;

	const options = new Map<number, string>();
	for (const match of followUpSection.matchAll(NUMBERED_PROMPT_PATTERN)) {
		const optionNumber = Number(match[1]);
		const optionText = match[2]?.trim();
		if (!Number.isSafeInteger(optionNumber) || !optionText) continue;
		options.set(optionNumber, parseNumberedPromptLine(optionText));
	}

	const selectedPrompts = selectedNumbers
		.map((number) => options.get(number))
		.filter((value) => value);
	if (selectedPrompts.length === 0) return null;

	return selectedPrompts.join("\n");
}

export function resolveNumberedFollowUpSelection(
	userText: string,
	conversationHistory: ModelMessage[]
): string | null {
	const selectedPrompt = resolveNumberedFollowUpPrompt(userText, conversationHistory);
	if (!selectedPrompt) return null;

	const selectedNumbers = getSelectionNumbers(userText);
	const lastAssistantText = getLastAssistantText(conversationHistory);
	if (selectedNumbers.length === 0 || !lastAssistantText) return null;

	return `<conversation-continuity>
The user selected numbered option${selectedNumbers.length === 1 ? "" : "s"} ${selectedNumbers.join(", ")} from the previous assistant message. Treat this as the selected prompt below, not as the literal reply "${userText.trim()}".

<previous-assistant-message>
${lastAssistantText}
</previous-assistant-message>

<selected-prompt>
${selectedPrompt}
</selected-prompt>
</conversation-continuity>`;
}

export function buildUserMessageWithFollowUpContext(
	userText: string,
	conversationHistory: ModelMessage[]
): string {
	const resolvedSelection = resolveNumberedFollowUpSelection(userText, conversationHistory);
	if (resolvedSelection) return resolvedSelection;

	if (!isShortContextualReply(userText)) return userText;

	const lastAssistantText = getLastAssistantText(conversationHistory);
	if (!lastAssistantText) return userText;

	return `<conversation-continuity>
The user is replying to the previous assistant message below. Interpret the short reply in that context.

<previous-assistant-message>
${lastAssistantText}
</previous-assistant-message>

<user-reply>
${userText}
</user-reply>
</conversation-continuity>`;
}
