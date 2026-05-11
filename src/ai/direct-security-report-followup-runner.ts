import type { ModelMessage } from "ai";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { StreamCallbacks, TokenUsage } from "../types";
import { getLastAssistantText } from "./follow-up-context";
import { getAppConfigDir } from "../utils/preferences";

export interface DirectSecurityReportFollowUpResult {
	fullText: string;
	responseMessages: ModelMessage[];
	usage?: TokenUsage;
	finalText?: string;
}

type ReportFollowUpIntent =
	| "owner-explanation"
	| "client-email"
	| "no-admin"
	| "insurance"
	| "selection"
	| "export";

const SECURITY_REPORT_PATTERN =
	/\bORPHEUS Security Snapshot\b|\bCyber Readiness Controls\b|\bSuggested Follow-up Prompts\b/i;
const SECURITY_REPORT_FOLLOWUP_CONTEXT_PATTERN =
	/\bSecurity Snapshot\b|\bWindows Security Snapshot\b|\bplain-English version of the Security Snapshot\b|\bcyber insurance readiness checklist\b/i;
const OWNER_EXPLANATION_PATTERN = /\b(explain|plain[-\s]?english|non[-\s]?technical|business owner|owner)\b/i;
const CLIENT_EMAIL_PATTERN = /\b(client[-\s]?ready|client email|email)\b/i;
const SHORT_EXPORT_PATTERN = /^(?:e|export|save|write|download)\s*$/i;
const EXPORT_REPORT_PATTERN =
	/\b(export|save|write|download)\b[\s\S]{0,120}\b(security\s+snapshot|snapshot|report|markdown|md|file)\b/i;
const NO_ADMIN_PATTERN = /\b(no[-\s]?admin|without admin|do not require admin|non[-\s]?admin)\b/i;
const INSURANCE_PATTERN = /\b(insurance|cyber insurance|readiness controls|checklist)\b/i;
const NUMBER_SELECTION_PATTERN = /^(?:item\s+|option\s+|#)?(\d+)[.!?]?$/i;
const RECENT_CONTEXT_LIMIT = 12;

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

function findRecentAssistantText(
	conversationHistory: ModelMessage[],
	predicate: (text: string) => boolean
): string | null {
	let seen = 0;
	for (let i = conversationHistory.length - 1; i >= 0; i--) {
		const message = conversationHistory[i];
		if (!message || message.role !== "assistant") continue;
		seen++;
		const text = messageContentToText(message);
		if (text && predicate(text)) return text;
		if (seen >= RECENT_CONTEXT_LIMIT) break;
	}
	return null;
}

function getRecentSecurityReportContext(conversationHistory: ModelMessage[]): string | null {
	return (
		findRecentAssistantText(conversationHistory, (text) => SECURITY_REPORT_PATTERN.test(text)) ??
		findRecentAssistantText(conversationHistory, (text) =>
			SECURITY_REPORT_FOLLOWUP_CONTEXT_PATTERN.test(text)
		)
	);
}

function getBestReportText(conversationHistory: ModelMessage[]): string {
	return (
		findRecentAssistantText(conversationHistory, (text) => SECURITY_REPORT_PATTERN.test(text)) ??
		getRecentSecurityReportContext(conversationHistory) ??
		getLastAssistantText(conversationHistory) ??
		""
	);
}

function getSelectionNumber(userText: string): number | null {
	const match = userText.trim().match(NUMBER_SELECTION_PATTERN);
	const value = match?.[1] ? Number(match[1]) : Number.NaN;
	return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function classifySecurityReportFollowUp(userText: string): ReportFollowUpIntent | null {
	const normalized = userText.trim();
	if (!normalized) return null;
	if (getSelectionNumber(normalized) !== null) return "selection";
	if (SHORT_EXPORT_PATTERN.test(normalized) || EXPORT_REPORT_PATTERN.test(normalized)) return "export";
	if (CLIENT_EMAIL_PATTERN.test(normalized)) return "client-email";
	if (NO_ADMIN_PATTERN.test(normalized)) return "no-admin";
	if (INSURANCE_PATTERN.test(normalized)) return "insurance";
	if (OWNER_EXPLANATION_PATTERN.test(normalized)) return "owner-explanation";
	return null;
}

export function shouldRunDirectSecurityReportFollowUp(
	userText: string,
	conversationHistory: ModelMessage[] = []
): boolean {
	return (
		getRecentSecurityReportContext(conversationHistory) !== null &&
		classifySecurityReportFollowUp(userText) !== null
	);
}

function extractSection(report: string, heading: string): string {
	const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = report.match(new RegExp(`## ${escaped}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i"));
	return match?.[1]?.trim() ?? "";
}

function sanitizeFilenameSegment(value: string): string {
	const trimmed = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return trimmed || "security-snapshot";
}

function timestampForFilename(date = new Date()): string {
	return date
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}Z$/, "Z");
}

function buildExportMarkdown(report: string, exportedAt = new Date()): string {
	return [
		"# Client-Ready Security Snapshot",
		"",
		`Prepared by: ORPHEUS`,
		`Prepared for: [Client / organization]`,
		`Prepared on: ${exportedAt.toISOString()}`,
		"",
		"> This report is based on local read-only Windows evidence. Review sensitive findings before sharing externally.",
		"",
		report.trim(),
		"",
	].join("\n");
}

export async function exportSecurityReportMarkdown(
	report: string,
	options: { now?: Date; outputDir?: string } = {}
): Promise<{ path: string; bytesWritten: number }> {
	const now = options.now ?? new Date();
	const title =
		report.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
		report.match(/\b(ORPHEUS Security Snapshot)\b/i)?.[1]?.trim() ??
		"ORPHEUS Security Snapshot";
	const fileName = `${sanitizeFilenameSegment(title)}-${timestampForFilename(now)}.md`;
	const outputDir = options.outputDir ?? path.join(getAppConfigDir(), "reports");
	const outputPath = path.join(outputDir, fileName);
	const content = buildExportMarkdown(report, now);

	await fs.mkdir(outputDir, { recursive: true });
	await fs.writeFile(outputPath, content, "utf8");

	return {
		path: outputPath,
		bytesWritten: Buffer.byteLength(content, "utf8"),
	};
}

function extractScoreLine(report: string): string {
	const score = report.match(/\*\*Score:\*\*\s*([^\n]+)/i)?.[1]?.trim();
	const risk = report.match(/\*\*Risk:\*\*\s*([^\n]+)/i)?.[1]?.trim();
	if (score && risk) return `The snapshot scored this machine at ${score}, with ${risk.toLowerCase()} risk.`;
	if (score) return `The snapshot score was ${score}.`;
	return "The snapshot produced a local Windows security summary.";
}

function firstLines(text: string, limit: number): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, limit);
}

function buildOwnerExplanation(report: string): string {
	const summary = firstLines(extractSection(report, "Executive Summary"), 3);
	const remediation = firstLines(extractSection(report, "Prioritized Remediation"), 5);
	const controls = firstLines(extractSection(report, "Cyber Readiness Controls"), 4);

	return [
		"Here is the plain-English version of the Security Snapshot.",
		"",
		extractScoreLine(report),
		"",
		"**What it means**",
		...(summary.length > 0
			? summary.map((line) => line.replace(/^-+\s*/, "- "))
			: ["- ORPHEUS reviewed local Windows evidence and turned it into a risk summary."]),
		"",
		"**What to pay attention to**",
		...(remediation.length > 0
			? remediation.map((line) => line.replace(/^-+\s*/, "- "))
			: ["- No priority remediation item was produced by the parser."]),
		"",
		"**Business controls to confirm**",
		...(controls.length > 0
			? controls.map((line) => line.replace(/^-+\s*/, "- "))
			: ["- Confirm MFA, backups, endpoint protection, and incident response outside the local scan."]),
		"",
		"Nothing in this explanation changes Windows settings. It is a plain-language summary of the report ORPHEUS already generated.",
	].join("\n");
}

function buildClientEmail(report: string): string {
	const summary = firstLines(extractSection(report, "Executive Summary"), 2);
	const remediation = firstLines(extractSection(report, "Prioritized Remediation"), 4);
	const questions = firstLines(extractSection(report, "Owner Questions"), 4);

	return [
		"Subject: Windows Security Snapshot Review",
		"",
		"Hi,",
		"",
		"We completed a local read-only Windows security snapshot and reviewed the evidence for common readiness areas such as endpoint protection, patching, firewall posture, privileged access, backups, MFA, and incident response.",
		"",
		extractScoreLine(report),
		"",
		"Key takeaways:",
		...(summary.length > 0
			? summary.map((line) => line.replace(/^-+\s*/, "- "))
			: ["- Local evidence was collected and reviewed."]),
		"",
		"Recommended next steps:",
		...(remediation.length > 0
			? remediation.map((line) => line.replace(/^-+\s*/, "- "))
			: ["- No priority remediation item was produced by the parser."]),
		"",
		"Items we need confirmed:",
		...(questions.length > 0
			? questions.map((line) => line.replace(/^-+\s*/, "- "))
			: ["- Confirm MFA, backups, and incident response ownership."]),
		"",
		"No changes were made during this snapshot. Any remediation should be reviewed and approved before implementation.",
	].join("\n");
}

function buildNoAdminFixes(report: string): string {
	const questions = firstLines(extractSection(report, "Owner Questions"), 6);
	const controls = firstLines(extractSection(report, "Cyber Readiness Controls"), 6);

	return [
		"Here are the useful next steps that do not require making administrator-level Windows changes.",
		"",
		"- Confirm MFA coverage for email, remote access, and administrator accounts.",
		"- Confirm backups are encrypted, separated from the device/network, and restore-tested.",
		"- Confirm there is a written incident response and recovery plan.",
		"- Review the report with the owner and identify which local administrator accounts and listening services are expected.",
		"- Schedule approved remediation for anything that needs firewall, Defender, account, or service changes.",
		"",
		"Evidence and questions from the report:",
		...(controls.length > 0 ? controls.map((line) => line.replace(/^-+\s*/, "- ")) : []),
		...(questions.length > 0 ? questions.map((line) => line.replace(/^-+\s*/, "- ")) : []),
	].join("\n");
}

function buildInsuranceChecklist(report: string): string {
	const controls = firstLines(extractSection(report, "Cyber Readiness Controls"), 8);
	const questions = firstLines(extractSection(report, "Owner Questions"), 8);

	return [
		"Cyber insurance readiness checklist from this snapshot:",
		"",
		...(controls.length > 0
			? controls.map((line) => line.replace(/^-+\s*/, "- "))
			: [
					"- Endpoint protection / EDR: confirm active coverage.",
					"- Patch management: confirm repeatable update process.",
					"- Firewall posture: confirm inbound defaults are appropriate.",
				]),
		"",
		"Open owner questions:",
		...(questions.length > 0
			? questions.map((line) => line.replace(/^-+\s*/, "- "))
			: [
					"- Do you enforce MFA for email, remote access, and administrator accounts?",
					"- Do you have encrypted, segregated backups and restore tests?",
					"- Do you have a written incident response plan?",
				]),
		"",
		"Use this as a questionnaire starting point. ORPHEUS can verify some local Windows evidence, but SaaS MFA, backups, training, and incident-response process still need owner confirmation.",
	].join("\n");
}

function extractActionableListItems(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.map((line) =>
			line
				.replace(/^\d+[.)]\s*/, "")
				.replace(/^[-*]\s*/, "")
				.trim()
		)
		.filter((line) => line.length > 0)
		.filter((line) => !/^Cyber insurance readiness checklist/i.test(line))
		.filter((line) => !/^Open owner questions:?$/i.test(line))
		.filter((line) => !/^Use this as a questionnaire starting point/i.test(line));
}

function buildSelectedChecklistItem(
	userText: string,
	conversationHistory: ModelMessage[],
	report: string
): string {
	const selection = getSelectionNumber(userText);
	if (selection === null) return buildInsuranceChecklist(report);

	const lastAssistantText = getLastAssistantText(conversationHistory) ?? "";
	const candidateItems = extractActionableListItems(lastAssistantText);
	const item = candidateItems[selection - 1];
	if (!item) {
		return [
			`I do not see item ${selection} in the previous checklist text.`,
			"",
			"Here is the checklist again so we can stay grounded:",
			"",
			buildInsuranceChecklist(report),
		].join("\n");
	}

	return [
		`Item ${selection}: ${item}`,
		"",
		"Plain-English follow-up:",
		`- Confirm whether this control is already in place.`,
		`- If it is not in place, assign an owner and target date.`,
		`- Keep evidence such as policy links, screenshots, ticket numbers, or vendor portal exports.`,
		"",
		"No tool call or Windows change is needed for this answer. This is a plain-language follow-up from the existing Security Snapshot context.",
	].join("\n");
}

function buildFollowUpText(
	intent: ReportFollowUpIntent,
	report: string,
	userText: string,
	conversationHistory: ModelMessage[]
): string {
	switch (intent) {
		case "client-email":
			return buildClientEmail(report);
		case "no-admin":
			return buildNoAdminFixes(report);
		case "insurance":
			return buildInsuranceChecklist(report);
		case "selection":
			return buildSelectedChecklistItem(userText, conversationHistory, report);
		default:
			return buildOwnerExplanation(report);
	}
}

export async function runDirectSecurityReportFollowUp(
	userText: string,
	conversationHistory: ModelMessage[],
	callbacks: StreamCallbacks
): Promise<DirectSecurityReportFollowUpResult> {
	const intent = classifySecurityReportFollowUp(userText) ?? "owner-explanation";
	const report = getBestReportText(conversationHistory);
	const finalText =
		intent === "export"
			? await exportSecurityReportMarkdown(report).then(
					(result) =>
						`Exported the latest ORPHEUS Security Snapshot.\n\nPath: ${result.path}\nBytes written: ${result.bytesWritten}\n\nReview the report before sharing externally; it may contain security-sensitive local evidence.`
				)
			: buildFollowUpText(intent, report, userText, conversationHistory);

	callbacks.onToken?.(finalText);
	const responseMessages: ModelMessage[] = [{ role: "assistant", content: finalText }];
	callbacks.onComplete?.(finalText, responseMessages, undefined, finalText);
	return { fullText: finalText, responseMessages, finalText };
}
