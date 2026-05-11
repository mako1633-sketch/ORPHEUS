import type { ModelMessage } from "ai";
import type { StreamCallbacks, TokenUsage } from "../types";

export interface DirectImplementationAdviceResult {
	fullText: string;
	responseMessages: ModelMessage[];
	usage?: TokenUsage;
	finalText?: string;
}

const IMPLEMENT_NOW_PATTERN =
	/\bwhat\s+can\s+you\s+implement\s+right\s+now\b|\bwhat\s+can\s+be\s+implemented\s+right\s+now\b|\bwhat\s+can\s+you\s+add\s+right\s+now\b/i;

export function shouldRunDirectImplementationAdvice(userText: string): boolean {
	return IMPLEMENT_NOW_PATTERN.test(userText.trim());
}

export async function runDirectImplementationAdvice(
	callbacks: StreamCallbacks
): Promise<DirectImplementationAdviceResult> {
	const finalText = [
		"The useful thing to implement right now is an interactive Remediation Queue.",
		"",
		"It should turn the evidence pack into operator work: open findings, SLA due dates, overdue flags, accepted-risk reviews, linked evidence artifacts, and scheduled security tasks in one terminal view.",
		"",
		"That is more valuable than another static report because it gives the user an immediate next action: who owns the risk, what is due, what can be verified, and what evidence proves it.",
	].join("\n");

	callbacks.onToken?.(finalText);
	const responseMessages: ModelMessage[] = [{ role: "assistant", content: finalText }];
	callbacks.onComplete?.(finalText, responseMessages, undefined, finalText);
	return { fullText: finalText, responseMessages, finalText };
}
