import type { ModelMessage } from "ai";
import { randomUUID } from "node:crypto";
import type { StreamCallbacks, ToolApprovalRequest, ToolApprovalResponse, TokenUsage } from "../types";
import { getLastAssistantText } from "./follow-up-context";
import { executeLocalShellCommand } from "./tools/run-bash";

export interface DirectWindowsRemediationResult {
	fullText: string;
	responseMessages: ModelMessage[];
	usage?: TokenUsage;
	finalText?: string;
}

const REMEDIATION_ACTION_PATTERN =
	/\b(do|enact|apply|implement|run|execute|perform|start|fix|remediate|harden)\b[\s\S]{0,120}\b(remediation|recommendation|plan|both|all|fix|improvement)s?\b/i;

const LEAST_PRIVILEGE_REMEDIATION_PATTERN =
	/\b(apply|employ|enforce|implement|use|do)\b[\s\S]{0,120}\b(?:principle\s+of\s+)?least\s+priv(?:i|e)ledge\b/i;

const PRIOR_REMEDIATION_PATTERN =
	/\bRemediation Plan\b|\bLocal administrator membership needs review\b|\bListening TCP services observed\b/i;

const REMEDIATION_SELECTION_PATTERN =
	/^(?:#?\d+(?:\s*(?:,|and)\s*#?\d+)*|option\s+\d+|both|all|both of them|all of them|these|those|these tasks?|the tasks?|yes|yes please|please do|do it|continue|go ahead|proceed|please proceed)$/i;

export function shouldRunDirectWindowsRemediation(
	userText: string,
	conversationHistory: ModelMessage[] = []
): boolean {
	const normalized = userText.trim();
	if (!normalized) return false;
	const lastAssistantText = getLastAssistantText(conversationHistory) ?? "";
	if (!PRIOR_REMEDIATION_PATTERN.test(lastAssistantText)) return false;
	return (
		REMEDIATION_ACTION_PATTERN.test(normalized) ||
		LEAST_PRIVILEGE_REMEDIATION_PATTERN.test(normalized) ||
		REMEDIATION_SELECTION_PATTERN.test(normalized)
	);
}

function describeRemediationRequest(userText: string): string {
	const normalized = userText
		.trim()
		.replace(/\s+/g, " ")
		.replace(/[.!?]+$/g, "");
	if (/^(both|all|both of them|all of them|these|those|these tasks?|the tasks?)$/i.test(normalized)) {
		return "all remediation recommendations from the previous plan";
	}
	if (/^(yes|yes please|please do|do it|continue|go ahead|proceed|please proceed)$/i.test(normalized)) {
		return "the remediation recommendations just proposed";
	}
	const numbers = normalized.match(/\d+/g);
	if (numbers?.length) {
		return `remediation recommendation${numbers.length > 1 ? "s" : ""} ${numbers.join(", ")}`;
	}
	if (LEAST_PRIVILEGE_REMEDIATION_PATTERN.test(normalized)) {
		return "least-privilege review of the previous remediation plan";
	}
	return userText;
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

function buildRemediationReviewCommand(): string {
	return [
		"Write-Output '### Local administrators current membership'",
		"Get-LocalGroupMember -Group Administrators | Select-Object Name,ObjectClass,PrincipalSource | Format-Table -AutoSize",
		"Write-Output ''",
		"Write-Output '### Listening TCP services with owning process'",
		"Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess,@{Name='ProcessName';Expression={(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName}} | Sort-Object LocalPort | Format-Table -AutoSize",
		"Write-Output ''",
		"Write-Output '### Firewall profiles'",
		"Get-NetFirewallProfile | Select-Object Name,Enabled,DefaultInboundAction | Format-Table -AutoSize",
	].join("; ");
}

function summarizeEvidence(output: string): string {
	const trimmed = output.trim();
	if (!trimmed) return "No command output was returned.";
	return trimmed.length > 4000 ? `${trimmed.slice(0, 4000)}\n... [output truncated]` : trimmed;
}

export async function runDirectWindowsRemediation(
	userText: string,
	callbacks: StreamCallbacks
): Promise<DirectWindowsRemediationResult> {
	const remediationRequest = describeRemediationRequest(userText);
	const command = buildRemediationReviewCommand();
	const runCallId = `direct-remediation-review-${randomUUID()}`;
	const approvalRequest: ToolApprovalRequest = {
		approvalId: `approval-${runCallId}`,
		toolName: "runBash",
		toolCallId: runCallId,
		input: {
			description: "Review remediation targets",
			command,
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
				error: `[DENIED] ${approval.reason ?? "The read-only remediation review was not approved."}`,
			},
			runCallId
		);
		const finalText =
			"Remediation not applied. I need the current administrator list and listening-port evidence before making changes, because these recommendations require choosing exactly which accounts or ports are expected.";
		callbacks.onToken?.(finalText);
		const responseMessages: ModelMessage[] = [{ role: "assistant", content: finalText }];
		callbacks.onComplete?.(finalText, responseMessages, undefined, finalText);
		return { fullText: finalText, responseMessages, finalText };
	}

	const commandResult = await executeLocalShellCommand({ command, timeout: 60000 });
	callbacks.onToolResult?.("runBash", commandResult, runCallId);

	const output = [commandResult.stdout, commandResult.stderr]
		.filter((part) => part.trim().length > 0)
		.join("\n\n");
	const finalText =
		`I started the remediation workflow for: ${remediationRequest}\n\n` +
		"These two recommendations are review-and-restrict items, so I did not remove administrator accounts or block ports automatically. The safe next step is to choose the specific administrator entries to remove and the specific listening ports/processes to restrict.\n\n" +
		"**Current Evidence**\n" +
		"```text\n" +
		summarizeEvidence(output || commandResult.error || "") +
		"\n```\n\n" +
		"Tell me which administrator entries are stale and which listening ports should be blocked or limited. I will then propose exact PowerShell commands with rollback steps and ask for approval before changing anything.";

	callbacks.onToken?.(finalText);
	const responseMessages: ModelMessage[] = [{ role: "assistant", content: finalText }];
	callbacks.onComplete?.(finalText, responseMessages, undefined, finalText);
	return { fullText: finalText, responseMessages, finalText };
}
