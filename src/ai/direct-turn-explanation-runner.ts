import type { ModelMessage } from "ai";
import type { StreamCallbacks, TokenUsage } from "../types";
import { detectAssistantResponseLeak } from "./assistant-response-guard";
import { getLastAssistantText } from "./follow-up-context";

export interface DirectTurnExplanationResult {
	fullText: string;
	responseMessages: ModelMessage[];
	usage?: TokenUsage;
	finalText?: string;
}

const TURN_EXPLANATION_PATTERN =
	/\b(what did you do|what was that|what happened there|why did you do that|why did you search|why are you|what are you doing)\b/i;

export function shouldRunDirectTurnExplanation(
	userText: string,
	conversationHistory: ModelMessage[] = []
): boolean {
	const normalized = userText.trim();
	if (!TURN_EXPLANATION_PATTERN.test(normalized)) return false;
	return Boolean(getLastAssistantText(conversationHistory)?.trim());
}

function summarizeLastAssistantAction(lastAssistantText: string): string {
	const leak = detectAssistantResponseLeak(lastAssistantText);
	if (leak === "tool-json") {
		if (/"action"\s*:\s*"write"[\s\S]*"todos"/i.test(lastAssistantText)) {
			return "I tried to write an internal todo/planning item, but it leaked into the chat as JSON. That should have been hidden behind the todo tool or skipped entirely for a simple reply.";
		}
		return "I exposed internal tool-call JSON as chat text. That was not a completed user-facing action.";
	}
	if (leak === "internal-instructions") {
		return "I exposed internal operating instructions instead of answering your question. That was a response failure, not useful work.";
	}
	if (/\bsearch\b|\bwebSearch\b/i.test(lastAssistantText)) {
		return "I started a search/research path from the previous message. If you were asking about the local Windows/security discussion, that was the wrong direction.";
	}
	return "I answered the previous turn in chat. I do not see evidence that a local system change, file write, Signal send, or approved shell command completed in that last response.";
}

export async function runDirectTurnExplanation(
	conversationHistory: ModelMessage[],
	callbacks: StreamCallbacks
): Promise<DirectTurnExplanationResult> {
	const lastAssistantText = getLastAssistantText(conversationHistory) ?? "";
	const finalText =
		`${summarizeLastAssistantAction(lastAssistantText)}\n\n` +
		"No Windows security settings were changed unless you saw and approved a shell/tool action. I’ll keep the next step grounded in the current conversation instead of guessing or launching unrelated tools.";

	callbacks.onToken?.(finalText);
	const responseMessages: ModelMessage[] = [{ role: "assistant", content: finalText }];
	callbacks.onComplete?.(finalText, responseMessages, undefined, finalText);
	return { fullText: finalText, responseMessages, finalText };
}
