import { randomUUID } from "node:crypto";
import type { ModelMessage } from "ai";
import type { StreamCallbacks, TokenUsage } from "../types";
import { buildDaemonStatusItems } from "./tools/daemon-status";

export interface DirectDaemonDoctorResult {
	fullText: string;
	responseMessages: ModelMessage[];
	usage?: TokenUsage;
	finalText?: string;
}

const DAEMON_DOCTOR_PATTERN =
	/\b(?:orpheus|daemon)\s+doctor\b|\b(doctor|status|setup)\b[\s\S]{0,120}\b(keys?|tools?|powershell|signal|search|exa|openrouter|openai)\b|\b(keys?|tools?|powershell|signal|search|exa|openrouter|openai)\b[\s\S]{0,120}\b(doctor|status|setup)\b/i;

export function shouldRunDirectDaemonDoctor(userText: string): boolean {
	const normalized = userText.trim();
	if (!normalized) return false;
	return DAEMON_DOCTOR_PATTERN.test(normalized);
}

function formatStatusLine(item: Awaited<ReturnType<typeof buildDaemonStatusItems>>[number]): string {
	const label = item.status.toUpperCase().padEnd(11);
	return `- ${label} ${item.label}: ${item.detail}`;
}

export async function runDirectDaemonDoctor(callbacks: StreamCallbacks): Promise<DirectDaemonDoctorResult> {
	const toolCallId = `direct-daemonStatus-${randomUUID()}`;
	callbacks.onToolCall?.("daemonStatus", { scope: "all" }, toolCallId);

	const items = await buildDaemonStatusItems();
	const result = {
		success: true,
		items,
		summary: {
			ok: items.filter((item) => item.status === "ok").length,
			needsAttention: items.filter((item) => item.status !== "ok").length,
			exaInvalid: items.some((item) => item.id === "EXA_API_KEY" && item.status === "invalid"),
		},
	};
	callbacks.onToolResult?.("daemonStatus", result, toolCallId);

	const needsAttention = items.filter((item) => item.status !== "ok");
	const finalText =
		`ORPHEUS doctor completed. ${result.summary.ok} checks are ok; ${result.summary.needsAttention} need attention.\n\n` +
		"**Status**\n" +
		items.map(formatStatusLine).join("\n") +
		(needsAttention.length > 0
			? "\n\n**Next**\n" + needsAttention.map((item) => `- Fix ${item.label}: ${item.detail}`).join("\n")
			: "\n\nAll checked capabilities are available.");

	callbacks.onToken?.(finalText);
	const responseMessages: ModelMessage[] = [{ role: "assistant", content: finalText }];
	callbacks.onComplete?.(finalText, responseMessages, undefined, finalText);
	return { fullText: finalText, responseMessages, finalText };
}
