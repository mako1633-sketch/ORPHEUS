import { randomUUID } from "node:crypto";
import type { ModelMessage } from "ai";
import { parseWindowsAssessmentOutput } from "../security/windows-assessment-parser";
import { buildWindowsRemediationPlan } from "../security/windows-remediation";
import {
	buildWindowsSecurityPlaybookCommand,
	getWindowsSecurityPlaybook,
	type WindowsSecurityPlaybookId,
} from "../security/windows-security-playbooks";
import { buildWindowsSecurityReport } from "../security/windows-security-report";
import type {
	StreamCallbacks,
	TokenUsage,
	ToolApprovalRequest,
	ToolApprovalResponse,
} from "../types";
import { getLastAssistantText } from "./follow-up-context";
import { executeLocalShellCommand } from "./tools/run-bash";

export interface DirectWindowsAssessmentResult {
	fullText: string;
	responseMessages: ModelMessage[];
	usage?: TokenUsage;
	finalText?: string;
}

const CLEAR_FULL_ASSESSMENT_PATTERN =
	/\b(full|complete|comprehensive)\b[\s\S]{0,100}\bwindows\b[\s\S]{0,100}\b(security|vulnerability|posture)\b[\s\S]{0,100}\b(assessment|audit|review)\b/i;

const QUICK_POSTURE_PATTERN =
	/\bquick\b[\s\S]{0,160}\b(windows|security|posture|assessment|playbook)\b/i;

const SECURITY_SIGNALS_REVIEW_PATTERN =
	/\b(defender|firewall)\b[\s\S]{0,180}\b(startup|services?|listening\s+ports?|ports?|logs?|event\s+signals?)\b|\b(startup|services?|listening\s+ports?|ports?|logs?|event\s+signals?)\b[\s\S]{0,180}\b(defender|firewall)\b/i;

const SECURITY_SNAPSHOT_PATTERN =
	/\b((?:orpheus|daemon)\s+)?(security\s+)?(snapshot|readiness\s+report|security\s+score|client[-\s]?ready\s+report|insurance[-\s]?readiness|cyber[-\s]?readiness)\b/i;

const FOLLOW_UP_ASSESSMENT_PATTERN = /\b(proceed|continue|run|start|assessment)\b/i;
const IMPERATIVE_ASSESSMENT_ACTION_PATTERN =
	/^(?:please\s+)?(run|start|perform|do|execute|launch|begin|check|scan|assess|audit|review|score|generate|produce|create)\b/i;
const REQUEST_ASSESSMENT_ACTION_PATTERN =
	/\b(can you|could you|please|i want you to|let'?s)\b[\s\S]{0,60}\b(run|start|perform|do|execute|launch|begin|check|scan|assess|audit|review|score|generate|produce|create)\b/i;
const CONVERSATIONAL_QUESTION_PATTERN =
	/^(what|why|how|when|where|who|can you explain|tell me about|explain)\b/i;
const REMEDIATION_ACTION_PATTERN =
	/\b(enact|apply|implement|remediate|fix|harden|change|execute)\b[\s\S]{0,80}\b(remediation|plan|recommendation|improvement|hardening|fix|change)s?\b|\b(remediation|hardening)\b[\s\S]{0,80}\b(plan|step|recommendation|action)s?\b/i;

function isActionRequest(userText: string): boolean {
	return (
		IMPERATIVE_ASSESSMENT_ACTION_PATTERN.test(userText) ||
		REQUEST_ASSESSMENT_ACTION_PATTERN.test(userText)
	);
}

function isConversationalQuestion(userText: string): boolean {
	return CONVERSATIONAL_QUESTION_PATTERN.test(userText.trim()) && !isActionRequest(userText);
}

export function shouldRunDirectWindowsAssessment(
	userText: string,
	conversationHistory: ModelMessage[] = []
): boolean {
	const normalized = userText.trim();
	if (!normalized) return false;
	if (REMEDIATION_ACTION_PATTERN.test(normalized)) return false;
	if (isConversationalQuestion(normalized)) return false;
	if (SECURITY_SNAPSHOT_PATTERN.test(normalized)) return isActionRequest(normalized);
	if (CLEAR_FULL_ASSESSMENT_PATTERN.test(normalized)) return isActionRequest(normalized);

	const lastAssistantText = getLastAssistantText(conversationHistory) ?? "";
	return (
		FOLLOW_UP_ASSESSMENT_PATTERN.test(normalized) &&
		/fullReadOnlyAssessment|full local Windows security assessment|read-only command bundle/i.test(
			lastAssistantText
		)
	);
}

export function shouldRunDirectWindowsSecuritySnapshot(userText: string): boolean {
	const normalized = userText.trim();
	if (!normalized) return false;
	if (REMEDIATION_ACTION_PATTERN.test(normalized)) return false;
	if (isConversationalQuestion(normalized)) return false;
	return SECURITY_SNAPSHOT_PATTERN.test(normalized) && isActionRequest(normalized);
}

export function shouldRunDirectWindowsQuickPosture(userText: string): boolean {
	const normalized = userText.trim();
	if (!normalized) return false;
	if (REMEDIATION_ACTION_PATTERN.test(normalized)) return false;
	if (isConversationalQuestion(normalized)) return false;
	return QUICK_POSTURE_PATTERN.test(normalized) && isActionRequest(normalized);
}

export function shouldRunDirectWindowsSecurityReview(userText: string): boolean {
	const normalized = userText.trim();
	if (!normalized) return false;
	if (REMEDIATION_ACTION_PATTERN.test(normalized)) return false;
	if (isConversationalQuestion(normalized)) return false;
	return SECURITY_SIGNALS_REVIEW_PATTERN.test(normalized) && isActionRequest(normalized);
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

function outputToParse(result: Awaited<ReturnType<typeof executeLocalShellCommand>>): string {
	return [result.stdout, result.stderr]
		.filter((part) => part.trim().length > 0)
		.join("\n\n")
		.trim();
}

function formatFindingList(findings: ReturnType<typeof parseWindowsAssessmentOutput>): string {
	return findings
		.map(
			(finding, index) =>
				`${index + 1}. **${finding.severity.toUpperCase()} - ${finding.title}**\n` +
				`Evidence: ${finding.evidence.slice(0, 600).trim()}\n` +
				`Risk: ${finding.risk}\n` +
				`Remediation: ${finding.remediation}`
		)
		.join("\n\n");
}

async function runDirectWindowsPlaybook(
	userText: string,
	callbacks: StreamCallbacks,
	playbookId: WindowsSecurityPlaybookId,
	runDescription: string,
	options: { snapshotReport?: boolean } = {}
): Promise<DirectWindowsAssessmentResult> {
	const playbook = getWindowsSecurityPlaybook(playbookId);
	const command = buildWindowsSecurityPlaybookCommand(playbookId);
	const windowsGetCallId = `direct-windowsSecurity-get-${randomUUID()}`;

	const playbookResult = {
		success: true,
		playbook: {
			id: playbook.id,
			title: playbook.title,
			description: playbook.description,
			riskLevel: playbook.riskLevel,
			checks: playbook.checks,
			command,
		},
	};

	callbacks.onToolCall?.(
		"windowsSecurity",
		{ action: "get", playbook: playbookId },
		windowsGetCallId
	);
	callbacks.onToolResult?.("windowsSecurity", playbookResult, windowsGetCallId);

	const runCallId = `direct-runBash-${randomUUID()}`;
	const approvalRequest: ToolApprovalRequest = {
		approvalId: `approval-${runCallId}`,
		toolName: "runBash",
		toolCallId: runCallId,
		input: {
			description: runDescription,
			command,
			timeout: 60000,
		},
	};

	const runInput = approvalRequest.input;
	callbacks.onToolCall?.("runBash", runInput, runCallId);
	const approval = await waitForApproval(callbacks, approvalRequest);
	if (!approval.approved) {
		callbacks.onToolResult?.(
			"runBash",
			{
				success: false,
				error: `[DENIED] ${approval.reason ?? "The read-only PowerShell command bundle was not approved."}`,
			},
			runCallId
		);
		const finalText = `Assessment not run. ${approval.reason ?? "The read-only PowerShell command bundle was not approved."}`;
		callbacks.onToken?.(finalText);
		const responseMessages: ModelMessage[] = [{ role: "assistant", content: finalText }];
		callbacks.onComplete?.(finalText, responseMessages, undefined, finalText);
		return { fullText: finalText, responseMessages, finalText };
	}

	const commandResult = await executeLocalShellCommand({
		command,
		timeout: 60000,
	});
	callbacks.onToolResult?.("runBash", commandResult, runCallId);

	const parseInput = outputToParse(commandResult);
	if (!parseInput) {
		const finalText =
			"The read-only assessment command completed without parseable output, so I did not call the parser. Check the shell result above for any execution error.";
		callbacks.onToken?.(finalText);
		const responseMessages: ModelMessage[] = [{ role: "assistant", content: finalText }];
		callbacks.onComplete?.(finalText, responseMessages, undefined, finalText);
		return { fullText: finalText, responseMessages, finalText };
	}

	const parseCallId = `direct-windowsSecurity-parse-${randomUUID()}`;
	callbacks.onToolCall?.(
		"windowsSecurity",
		{ action: "parse", playbook: playbookId, output: "[captured command output]", save: false },
		parseCallId
	);
	const findings = parseWindowsAssessmentOutput(parseInput);
	const remediationPlan = buildWindowsRemediationPlan(findings);
	const report = buildWindowsSecurityReport(findings, remediationPlan, {
		title: options.snapshotReport ? "ORPHEUS Security Snapshot" : `${playbook.title} Report`,
	});
	const parseResult = {
		success: true,
		findings,
		remediationPlan,
		report,
		history: null,
	};
	callbacks.onToolResult?.("windowsSecurity", parseResult, parseCallId);

	const finalText = options.snapshotReport
		? report.markdown
		: `Completed ${playbook.title} for: ${userText}\n\n` +
			`**Findings**\n${formatFindingList(findings)}\n\n` +
			`**Remediation Plan**\n` +
			(remediationPlan.length > 0
				? remediationPlan
						.map(
							(step, index) =>
								`${index + 1}. ${step.title}: ${step.proposedAction} Approval required before changes. Rollback: ${step.rollback}`
						)
						.join("\n")
				: "No non-informational remediation steps were generated by the parser.");

	callbacks.onToken?.(finalText);
	const responseMessages: ModelMessage[] = [{ role: "assistant", content: finalText }];
	callbacks.onComplete?.(finalText, responseMessages, undefined, finalText);
	return { fullText: finalText, responseMessages, finalText };
}

export async function runDirectWindowsAssessment(
	userText: string,
	callbacks: StreamCallbacks
): Promise<DirectWindowsAssessmentResult> {
	return runDirectWindowsPlaybook(
		userText,
		callbacks,
		"fullReadOnlyAssessment",
		"Run full read-only Windows assessment"
	);
}

export async function runDirectWindowsSecuritySnapshot(
	userText: string,
	callbacks: StreamCallbacks
): Promise<DirectWindowsAssessmentResult> {
	return runDirectWindowsPlaybook(
		userText,
		callbacks,
		"fullReadOnlyAssessment",
		"Run ORPHEUS Security Snapshot",
		{ snapshotReport: true }
	);
}

export async function runDirectWindowsQuickPosture(
	userText: string,
	callbacks: StreamCallbacks
): Promise<DirectWindowsAssessmentResult> {
	return runDirectWindowsPlaybook(
		userText,
		callbacks,
		"quickPosture",
		"Run quick Windows posture check"
	);
}

export async function runDirectWindowsSecurityReview(
	userText: string,
	callbacks: StreamCallbacks
): Promise<DirectWindowsAssessmentResult> {
	return runDirectWindowsPlaybook(
		userText,
		callbacks,
		"securitySignalsReview",
		"Run Windows security signals review"
	);
}
