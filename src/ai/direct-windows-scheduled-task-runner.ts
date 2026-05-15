import { randomUUID } from "node:crypto";
import type { ModelMessage } from "ai";
import {
	type WindowsSecurityScheduledTaskOperation,
	type WindowsSecurityScheduledTaskTemplateId,
	buildWindowsSecurityScheduledTaskPlan,
	listWindowsSecurityScheduledTaskTemplates,
} from "../security/windows-scheduled-tasks";
import type { StreamCallbacks, TokenUsage, ToolApprovalRequest, ToolApprovalResponse } from "../types";
import { executeLocalShellCommand } from "./tools/run-bash";

export interface DirectWindowsScheduledTaskResult {
	fullText: string;
	responseMessages: ModelMessage[];
	usage?: TokenUsage;
	finalText?: string;
}

const SCHEDULED_TASK_SECURITY_PATTERN =
	/\b(scheduled\s+tasks?|task\s+scheduler|schedule(?:d)?\s+(?:defender|security|scan|event|audit)|recurring\s+(?:defender|security|scan|event|audit))\b/i;
const MODIFY_PATTERN = /\b(update|modify|change|set|create|add|register|enable|disable|delete|remove)\b/i;

export function shouldRunDirectWindowsScheduledTaskSecurity(userText: string): boolean {
	const normalized = userText.trim();
	if (!normalized) return false;
	return SCHEDULED_TASK_SECURITY_PATTERN.test(normalized) && MODIFY_PATTERN.test(normalized);
}

function classifyOperation(userText: string): WindowsSecurityScheduledTaskOperation {
	if (/\b(delete|remove|unregister)\b/i.test(userText)) return "delete";
	if (/\bdisable|turn\s+off\b/i.test(userText)) return "disable";
	if (/\benable|turn\s+on\b/i.test(userText)) return "enable";
	if (/\b(update|modify|change|set)\b/i.test(userText)) return "update";
	return "create";
}

function classifyTemplate(userText: string): WindowsSecurityScheduledTaskTemplateId {
	if (/\b(full\s+scan|deep\s+scan|weekly)\b/i.test(userText)) return "defenderFullScanWeekly";
	if (/\b(event|log|audit|export)\b/i.test(userText)) return "securityEventExportDaily";
	return "defenderQuickScanDaily";
}

function waitForApproval(
	callbacks: StreamCallbacks,
	request: ToolApprovalRequest
): Promise<ToolApprovalResponse> {
	callbacks.onToolApprovalRequest?.(request);

	if (!callbacks.onAwaitingApprovals) {
		return Promise.resolve({
			approvalId: request.approvalId,
			approved: false,
			reason: "Approval UI is unavailable for this run.",
		});
	}

	return new Promise((resolve) => {
		callbacks.onAwaitingApprovals?.([request], (responses) => {
			const response = responses.find((item) => item.approvalId === request.approvalId);
			resolve(
				response ?? {
					approvalId: request.approvalId,
					approved: false,
					reason: "No approval response was received.",
				}
			);
		});
	});
}

function summarizeOutput(output: string): string {
	const trimmed = output.trim();
	if (!trimmed) return "No command output was returned.";
	return trimmed.length > 3000 ? `${trimmed.slice(0, 3000)}\n... [output truncated]` : trimmed;
}

function buildDeniedText(reason?: string): string {
	const templates = listWindowsSecurityScheduledTaskTemplates()
		.map((template) => `- ${template.id}: ${template.description} Default: ${template.defaultTrigger}`)
		.join("\n");

	return [
		`Scheduled task change not applied. ${reason ?? "The approval request was denied."}`,
		"",
		"Available security task templates:",
		templates,
		"",
		"Ask again with a specific template when ready, for example: create a daily Defender quick scan scheduled task.",
	].join("\n");
}

export async function runDirectWindowsScheduledTaskSecurity(
	userText: string,
	callbacks: StreamCallbacks
): Promise<DirectWindowsScheduledTaskResult> {
	const operation = classifyOperation(userText);
	const templateId = classifyTemplate(userText);
	const plan = buildWindowsSecurityScheduledTaskPlan(operation, templateId);
	const planCallId = `direct-windowsHardening-scheduledTaskPlan-${randomUUID()}`;

	callbacks.onToolCall?.(
		"windowsHardening",
		{
			action: "scheduledTaskPlan",
			scheduledTaskOperation: operation,
			scheduledTaskTemplate: templateId,
		},
		planCallId
	);
	callbacks.onToolResult?.("windowsHardening", { success: true, plan }, planCallId);

	const runCallId = `direct-runBash-scheduledTaskChange-${randomUUID()}`;
	const approvalRequest: ToolApprovalRequest = {
		approvalId: `approval-${runCallId}`,
		toolName: "runBash",
		toolCallId: runCallId,
		input: {
			description: `${operation} ORPHEUS security task`,
			command: plan.command,
			timeout: 60000,
		},
	};

	callbacks.onToolCall?.("runBash", approvalRequest.input, runCallId);
	const approval = await waitForApproval(callbacks, approvalRequest);
	if (!approval.approved) {
		callbacks.onToolResult?.(
			"runBash",
			{
				success: false,
				error: `[DENIED] ${approval.reason ?? "The scheduled-task change was not approved."}`,
			},
			runCallId
		);
		const finalText = buildDeniedText(approval.reason);
		callbacks.onToken?.(finalText);
		const responseMessages: ModelMessage[] = [{ role: "assistant", content: finalText }];
		callbacks.onComplete?.(finalText, responseMessages, undefined, finalText);
		return { fullText: finalText, responseMessages, finalText };
	}

	const commandResult = await executeLocalShellCommand({ command: plan.command, timeout: 60000 });
	callbacks.onToolResult?.("runBash", commandResult, runCallId);
	const output = [commandResult.stdout, commandResult.stderr, commandResult.error]
		.filter((part): part is string => Boolean(part && part.trim()))
		.join("\n\n");

	const finalText = [
		`${commandResult.success ? "Scheduled security task updated." : "Scheduled security task command failed."}`,
		"",
		`Task: ${plan.template.taskPath}${plan.template.name}`,
		`Operation: ${plan.operation}`,
		`Security value: ${plan.template.securityValue}`,
		"",
		"Rollback command:",
		"```powershell",
		plan.rollbackCommand,
		"```",
		"",
		"Command output:",
		"```text",
		summarizeOutput(output),
		"```",
	].join("\n");

	callbacks.onToken?.(finalText);
	const responseMessages: ModelMessage[] = [{ role: "assistant", content: finalText }];
	callbacks.onComplete?.(finalText, responseMessages, undefined, finalText);
	return { fullText: finalText, responseMessages, finalText };
}
