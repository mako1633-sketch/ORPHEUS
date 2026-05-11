import type { ModelMessage } from "ai";
import { randomUUID } from "node:crypto";
import { saveWindowsAssessmentRecord } from "../security/windows-assessment-history";
import { parseWindowsAssessmentOutput } from "../security/windows-assessment-parser";
import {
	buildWindowsSecurityPlaybookCommand,
	getWindowsSecurityPlaybook,
} from "../security/windows-security-playbooks";
import { buildWindowsRemediationPlan } from "../security/windows-remediation";
import { buildWindowsSecurityReport } from "../security/windows-security-report";
import { exportSecurityEvidencePack } from "../security/security-evidence-pack";
import { syncRemediationLedgerFromAssessment } from "../security/security-engagements";
import type { StreamCallbacks, ToolApprovalRequest, ToolApprovalResponse, TokenUsage } from "../types";
import { executeLocalShellCommand } from "./tools/run-bash";

export interface DirectSecurityEvidencePackResult {
	fullText: string;
	responseMessages: ModelMessage[];
	usage?: TokenUsage;
	finalText?: string;
}

const EVIDENCE_PACK_PATTERN =
	/\b(evidence\s+pack|managed\s+security\s+pack|security\s+engagement|client\s+pack|client\s+evidence|billable\s+assessment)\b/i;
const ACTION_PATTERN = /\b(run|create|generate|produce|start|build|prepare)\b/i;

export function shouldRunDirectSecurityEvidencePack(userText: string): boolean {
	const normalized = userText.trim();
	if (!normalized) return false;
	return EVIDENCE_PACK_PATTERN.test(normalized) && ACTION_PATTERN.test(normalized);
}

function extractClientName(userText: string): string {
	const match =
		userText.match(
			/\b(?:for|client|customer)\s+["']?([^"',.?!\n]+?)["']?(?:\s+(?:using|with|on|from)\b|[,.?!]|$)/i
		) ?? userText.match(/\b(?:for|client|customer)\s+["']?([^"',.?!\n]+)["']?/i);
	return match?.[1]?.trim() || "Client";
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

export async function runDirectSecurityEvidencePack(
	userText: string,
	callbacks: StreamCallbacks
): Promise<DirectSecurityEvidencePackResult> {
	const clientName = extractClientName(userText);
	const playbookId = "fullReadOnlyAssessment";
	const playbook = getWindowsSecurityPlaybook(playbookId);
	const command = buildWindowsSecurityPlaybookCommand(playbookId);
	const getCallId = `direct-evidencePack-get-${randomUUID()}`;

	callbacks.onToolCall?.("windowsSecurity", { action: "get", playbook: playbookId }, getCallId);
	callbacks.onToolResult?.(
		"windowsSecurity",
		{
			success: true,
			playbook: {
				id: playbook.id,
				title: playbook.title,
				description: playbook.description,
				riskLevel: playbook.riskLevel,
				checks: playbook.checks,
				command,
			},
		},
		getCallId
	);

	const runCallId = `direct-evidencePack-runBash-${randomUUID()}`;
	const approvalRequest: ToolApprovalRequest = {
		approvalId: `approval-${runCallId}`,
		toolName: "runBash",
		toolCallId: runCallId,
		input: {
			description: `Run evidence pack assessment for ${clientName}`,
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
				error: `[DENIED] ${approval.reason ?? "The read-only evidence collection was not approved."}`,
			},
			runCallId
		);
		const finalText = `Evidence pack not created. ${approval.reason ?? "The read-only evidence collection was not approved."}`;
		callbacks.onToken?.(finalText);
		const responseMessages: ModelMessage[] = [{ role: "assistant", content: finalText }];
		callbacks.onComplete?.(finalText, responseMessages, undefined, finalText);
		return { fullText: finalText, responseMessages, finalText };
	}

	const commandResult = await executeLocalShellCommand({ command, timeout: 60000 });
	callbacks.onToolResult?.("runBash", commandResult, runCallId);
	const parseInput = outputToParse(commandResult);
	if (!parseInput) {
		const finalText =
			"The read-only evidence command completed without parseable output, so I did not create an evidence pack.";
		callbacks.onToken?.(finalText);
		const responseMessages: ModelMessage[] = [{ role: "assistant", content: finalText }];
		callbacks.onComplete?.(finalText, responseMessages, undefined, finalText);
		return { fullText: finalText, responseMessages, finalText };
	}

	const parseCallId = `direct-evidencePack-parse-${randomUUID()}`;
	callbacks.onToolCall?.(
		"windowsSecurity",
		{ action: "parse", playbook: playbookId, output: "[captured command output]", save: true },
		parseCallId
	);
	const findings = parseWindowsAssessmentOutput(parseInput);
	const remediationPlan = buildWindowsRemediationPlan(findings);
	const report = buildWindowsSecurityReport(findings, remediationPlan, {
		title: `${clientName} ORPHEUS Security Snapshot`,
	});
	const history = await saveWindowsAssessmentRecord({
		playbookId,
		findings,
		clientName,
	});
	const engagementSync = await syncRemediationLedgerFromAssessment({
		clientName,
		record: history.record,
		diff: history.diff,
		findings,
	});
	const pack = await exportSecurityEvidencePack({
		clientName,
		playbookId,
		command,
		commandOutput: parseInput,
		findings,
		remediationPlan,
		report,
		history,
		engagement: engagementSync.client,
		ledger: engagementSync.ledger,
		ledgerSync: engagementSync,
	});
	await syncRemediationLedgerFromAssessment({
		clientName,
		record: history.record,
		diff: history.diff,
		findings,
		evidencePackPath: pack.path,
	});
	callbacks.onToolResult?.(
		"windowsSecurity",
		{
			success: true,
			findings,
			remediationPlan,
			report,
			history,
			engagement: engagementSync,
			evidencePack: {
				path: pack.path,
				portalPath: pack.portalPath,
				manifestPath: pack.manifestPath,
				indexPath: pack.indexPath,
				bytesWritten: pack.bytesWritten,
			},
		},
		parseCallId
	);

	const finalText = [
		`Created a Managed Security Evidence Pack for ${clientName}.`,
		"",
		`Path: ${pack.path}`,
		`Portal: ${pack.portalPath}`,
		`Manifest: ${pack.manifestPath}`,
		`Index: ${pack.indexPath}`,
		`Score: ${report.score}/100`,
		`Risk: ${report.risk}`,
		`Findings: ${findings.length}`,
		`Remediation steps: ${remediationPlan.length}`,
		`Delta: ${history.diff.addedFindingIds.length} added, ${history.diff.resolvedFindingIds.length} resolved, ${history.diff.unchangedFindingIds.length} unchanged`,
		`Ledger: ${engagementSync.openedIssueIds.length} opened, ${engagementSync.verifiedIssueIds.length} verified, ${engagementSync.unchangedIssueIds.length} still present`,
		"",
		"Review before sharing externally; it may contain security-sensitive local evidence.",
	].join("\n");

	callbacks.onToken?.(finalText);
	const responseMessages: ModelMessage[] = [{ role: "assistant", content: finalText }];
	callbacks.onComplete?.(finalText, responseMessages, undefined, finalText);
	return { fullText: finalText, responseMessages, finalText };
}
