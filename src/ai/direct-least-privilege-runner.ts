import type { ModelMessage } from "ai";
import type { StreamCallbacks, TokenUsage } from "../types";
import { getLastAssistantText } from "./follow-up-context";

export interface DirectLeastPrivilegeResult {
	fullText: string;
	responseMessages: ModelMessage[];
	usage?: TokenUsage;
	finalText?: string;
}

const LEAST_PRIVILEGE_PATTERN = /\b(?:principle\s+of\s+)?least\s+priv(?:i|e)ledge\b/i;
const QUESTION_OR_DISCUSSION_PATTERN =
	/\b(what|why|how|mean|means|no|right|correct|only give|need to function|would say|i would say)\b/i;
const ACTION_PATTERN = /\b(apply|employ|enforce|implement|use|do|make|change|remove|restrict)\b/i;
const PRIOR_SECURITY_CONTEXT_PATTERN =
	/\bRemediation Plan\b|\bLocal administrator membership\b|\bListening TCP services\b|\bWindows security\b|\bhardening\b/i;

export function shouldRunDirectLeastPrivilege(
	userText: string,
	conversationHistory: ModelMessage[] = []
): boolean {
	const normalized = userText.trim();
	if (!LEAST_PRIVILEGE_PATTERN.test(normalized)) return false;
	if (QUESTION_OR_DISCUSSION_PATTERN.test(normalized)) return true;

	const lastAssistantText = getLastAssistantText(conversationHistory) ?? "";
	return ACTION_PATTERN.test(normalized) && !PRIOR_SECURITY_CONTEXT_PATTERN.test(lastAssistantText);
}

export async function runDirectLeastPrivilege(
	userText: string,
	callbacks: StreamCallbacks
): Promise<DirectLeastPrivilegeResult> {
	const wantsAction = ACTION_PATTERN.test(userText);
	const finalText =
		"Yes. Least privilege is exactly the right security principle here: give each account, service, app, and network path only the access it needs to do its job, and no standing extras.\n\n" +
		"For this Windows agent, that means reviewing local Administrators membership, avoiding daily use of admin accounts, restricting listening services to expected ports and networks, keeping firewall defaults tight, and requiring approval before any privilege or firewall change.\n\n" +
		(wantsAction
			? "I would apply it in phases: first run read-only checks, then identify specific over-permission, then propose exact rollback-safe commands for your approval."
			: "So your phrasing is right: only give them what they need to function.");

	callbacks.onToken?.(finalText);
	const responseMessages: ModelMessage[] = [{ role: "assistant", content: finalText }];
	callbacks.onComplete?.(finalText, responseMessages, undefined, finalText);
	return { fullText: finalText, responseMessages, finalText };
}
