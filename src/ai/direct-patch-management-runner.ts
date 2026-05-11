import type { ModelMessage } from "ai";
import type { StreamCallbacks, TokenUsage } from "../types";
import { getLastAssistantText, isShortContextualReply } from "./follow-up-context";

export interface DirectPatchManagementResult {
	fullText: string;
	responseMessages: ModelMessage[];
	usage?: TokenUsage;
	finalText?: string;
}

const PATCH_MANAGEMENT_PATTERN =
	/\b(patch management|patch posture|windows update|installed updates|missing patches|update posture|automate updates?|automate patch)\b/i;
const PATCH_CONTEXT_PATTERN =
	/\b(patch management|patch posture|patchPosture|windowsSecurity|Windows Update|installed updates|update posture)\b/i;
const PATCH_SHORT_FOLLOWUP_PATTERN = /^(well|well\?|okay|ok|so|and|then what|what now)[.!?]*$/i;

function messageContentToText(message: ModelMessage): string {
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			if ("type" in part && part.type === "text" && "text" in part && typeof part.text === "string") {
				return part.text;
			}
			return "";
		})
		.join("")
		.trim();
}

function hasRecentPatchContext(conversationHistory: ModelMessage[]): boolean {
	let seen = 0;
	for (let i = conversationHistory.length - 1; i >= 0; i--) {
		const message = conversationHistory[i];
		if (!message || message.role !== "assistant") continue;
		seen++;
		const text = messageContentToText(message);
		if (PATCH_CONTEXT_PATTERN.test(text)) return true;
		if (seen >= 8) break;
	}
	return false;
}

export function shouldRunDirectPatchManagement(
	userText: string,
	conversationHistory: ModelMessage[] = []
): boolean {
	const normalized = userText.trim();
	if (!normalized) return false;
	if (PATCH_MANAGEMENT_PATTERN.test(normalized)) return true;
	return (
		(isShortContextualReply(normalized) || PATCH_SHORT_FOLLOWUP_PATTERN.test(normalized)) &&
		hasRecentPatchContext(conversationHistory)
	);
}

function buildPatchManagementText(): string {
	return [
		"I can automate patch management in three layers.",
		"",
		"**1. Read-only assessment**",
		"- Collect Windows build, installed hotfixes, recent update history, reboot-pending indicators, Defender signature age, and Windows Update service posture.",
		"- Parse the evidence into a simple status: current, needs review, or stale/unknown.",
		"- Compare later snapshots so you can show before/after progress.",
		"",
		"**2. Guided remediation**",
		"- I can propose exact PowerShell for safe checks and Windows Update actions, but anything that changes the machine must go through approval first.",
		"- I can separate user-safe tasks from admin-required tasks.",
		"- I can produce a client/owner summary that says what was checked, what changed, and what still needs confirmation.",
		"",
		"**3. What I should not pretend to automate**",
		"- I cannot verify SaaS patch policies, MDM/Intune rings, third-party EDR policy, or backup tooling purely from this local snapshot.",
		"- I should not claim patches were applied unless the command output proves it.",
		"",
		"Best immediate automation: run a read-only patch posture check, parse the result, then offer approved remediation steps. No settings change until you approve the exact command.",
	].join("\n");
}

function buildShortFollowUpText(conversationHistory: ModelMessage[]): string {
	const lastAssistantText = getLastAssistantText(conversationHistory) ?? "";
	if (!lastAssistantText || !PATCH_CONTEXT_PATTERN.test(lastAssistantText)) return buildPatchManagementText();

	return [
		"Concrete answer: I can automate the assessment and reporting almost completely; remediation is approval-gated.",
		"",
		"- Fully automatic: collect patch/update evidence, parse it, score it, save a snapshot, and explain gaps.",
		"- Semi-automatic: generate remediation commands and rollback notes for you to approve.",
		"- Not automatic without external access: SaaS patch policy, Intune/MDM rings, third-party app patching coverage, and business process evidence.",
		"",
		"I should have answered that directly instead of exposing fake action JSON.",
	].join("\n");
}

export async function runDirectPatchManagement(
	userText: string,
	conversationHistory: ModelMessage[],
	callbacks: StreamCallbacks
): Promise<DirectPatchManagementResult> {
	const finalText =
		(isShortContextualReply(userText) || PATCH_SHORT_FOLLOWUP_PATTERN.test(userText.trim())) &&
		hasRecentPatchContext(conversationHistory)
			? buildShortFollowUpText(conversationHistory)
			: buildPatchManagementText();

	callbacks.onToken?.(finalText);
	const responseMessages: ModelMessage[] = [{ role: "assistant", content: finalText }];
	callbacks.onComplete?.(finalText, responseMessages, undefined, finalText);
	return { fullText: finalText, responseMessages, finalText };
}
