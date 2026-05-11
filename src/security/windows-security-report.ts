import type { AssessmentFinding, AssessmentSeverity } from "./windows-assessment-parser";
import type { RemediationStep } from "./windows-remediation";

export type SecurityReportCategory =
	| "Updates"
	| "Defender"
	| "Firewall"
	| "Accounts"
	| "Startup"
	| "Services"
	| "Ports"
	| "Logs"
	| "General";

export type SecurityReportActionStage = "Do now" | "Needs admin" | "May affect usability" | "Watch/review";

export interface SecurityScoreBreakdown {
	category: SecurityReportCategory;
	score: number;
	status: "good" | "review" | "needs-attention";
	summary: string;
}

export interface SecurityReportFinding extends AssessmentFinding {
	category: SecurityReportCategory;
}

export interface SecurityReportAction {
	stage: SecurityReportActionStage;
	title: string;
	action: string;
	findingId: string;
}

export interface CyberReadinessControl {
	id: string;
	title: string;
	status: "evidence-collected" | "needs-review" | "questionnaire";
	note: string;
}

export interface PromptSuggestion {
	label: string;
	prompt: string;
}

export interface WindowsSecurityReport {
	title: string;
	score: number;
	risk: "Low" | "Medium" | "High";
	executiveSummary: string[];
	breakdown: SecurityScoreBreakdown[];
	findings: SecurityReportFinding[];
	actions: SecurityReportAction[];
	cyberReadinessControls: CyberReadinessControl[];
	questionnairePrompts: string[];
	promptSuggestions: PromptSuggestion[];
	markdown: string;
}

const ALL_CATEGORIES: SecurityReportCategory[] = [
	"Updates",
	"Defender",
	"Firewall",
	"Accounts",
	"Startup",
	"Services",
	"Ports",
	"Logs",
	"General",
];

const SEVERITY_WEIGHTS: Record<AssessmentSeverity, number> = {
	high: 18,
	medium: 10,
	low: 4,
	info: 0,
};

function clampScore(score: number): number {
	return Math.max(0, Math.min(100, Math.round(score)));
}

function riskForScore(score: number): WindowsSecurityReport["risk"] {
	if (score < 60) return "High";
	if (score < 85) return "Medium";
	return "Low";
}

export function categoryForFinding(finding: Pick<AssessmentFinding, "id" | "title">): SecurityReportCategory {
	const text = `${finding.id} ${finding.title}`.toLowerCase();
	if (/update|hotfix|patch/.test(text)) return "Updates";
	if (/defender|antivirus|signature|realtime|real-time/.test(text)) return "Defender";
	if (/firewall|inbound/.test(text)) return "Firewall";
	if (/admin|account|user|privilege|membership/.test(text)) return "Accounts";
	if (/startup|autorun|persistence/.test(text)) return "Startup";
	if (/service/.test(text)) return "Services";
	if (/port|listening|tcp/.test(text)) return "Ports";
	if (/event|log|audit/.test(text)) return "Logs";
	return "General";
}

function actionStageForFinding(finding: AssessmentFinding): SecurityReportActionStage {
	if (finding.severity === "high") return "Do now";
	if (/admin|firewall|defender|protection|policy/i.test(`${finding.title} ${finding.remediation}`)) {
		return "Needs admin";
	}
	if (/inbound|administrator|remove|disable|rdp|service/i.test(`${finding.title} ${finding.remediation}`)) {
		return "May affect usability";
	}
	return "Watch/review";
}

function buildBreakdown(findings: SecurityReportFinding[]): SecurityScoreBreakdown[] {
	return ALL_CATEGORIES.map((category) => {
		const categoryFindings = findings.filter((finding) => finding.category === category);
		const penalty = categoryFindings.reduce((sum, finding) => sum + SEVERITY_WEIGHTS[finding.severity], 0);
		const score = clampScore(100 - penalty);
		const highCount = categoryFindings.filter((finding) => finding.severity === "high").length;
		const actionableCount = categoryFindings.filter((finding) => finding.severity !== "info").length;
		const status = highCount > 0 ? "needs-attention" : actionableCount > 0 ? "review" : "good";
		const summary =
			actionableCount > 0
				? `${actionableCount} item${actionableCount === 1 ? "" : "s"} need review.`
				: categoryFindings.length > 0
					? "Evidence collected; no high-confidence issue detected."
					: "No parser signal collected for this category.";
		return { category, score, status, summary };
	});
}

function buildExecutiveSummary(
	score: number,
	risk: WindowsSecurityReport["risk"],
	findings: SecurityReportFinding[],
	actions: SecurityReportAction[]
): string[] {
	const high = findings.filter((finding) => finding.severity === "high");
	const medium = findings.filter((finding) => finding.severity === "medium");
	const low = findings.filter((finding) => finding.severity === "low");
	const topAction = actions[0];

	const summary = [
		`Overall posture is ${risk.toLowerCase()} risk at ${score}/100 based on the local read-only Windows evidence ORPHEUS could parse.`,
	];

	if (high.length > 0) {
		summary.push(
			`${high.length} high-severity issue${high.length === 1 ? "" : "s"} should be addressed first.`
		);
	} else if (medium.length > 0) {
		summary.push(
			"No high-severity issue was detected by the parser; medium-severity items should be reviewed next."
		);
	} else if (low.length > 0) {
		summary.push("Only low-severity review items were detected by the parser.");
	} else {
		summary.push(
			"No actionable issue was detected by the parser; manual review is still recommended for business controls."
		);
	}

	if (topAction) {
		summary.push(`Next best action: ${topAction.action}`);
	}

	return summary;
}

function buildReadinessControls(findings: SecurityReportFinding[]): CyberReadinessControl[] {
	const hasDefender = findings.some((finding) => finding.category === "Defender");
	const hasFirewall = findings.some((finding) => finding.category === "Firewall");
	const hasAccounts = findings.some((finding) => finding.category === "Accounts");
	const hasUpdates = findings.some((finding) => finding.category === "Updates");

	return [
		{
			id: "endpoint-protection",
			title: "Endpoint protection / EDR equivalent",
			status: hasDefender ? "evidence-collected" : "needs-review",
			note: hasDefender
				? "Local Defender evidence was collected. Confirm any third-party EDR is enabled and in block mode if used."
				: "No endpoint-protection finding was produced by the parser; confirm Defender or another EDR is active.",
		},
		{
			id: "patch-management",
			title: "Patch management",
			status: hasUpdates ? "evidence-collected" : "needs-review",
			note: "Use Windows build and hotfix evidence to confirm recent servicing and a repeatable patch process.",
		},
		{
			id: "firewall",
			title: "Firewall posture",
			status: hasFirewall ? "evidence-collected" : "needs-review",
			note: "Confirm firewall profiles are enabled and default inbound behavior matches business needs.",
		},
		{
			id: "privileged-access",
			title: "Privileged access review",
			status: hasAccounts ? "evidence-collected" : "needs-review",
			note: "Review local administrator membership and remove stale standing access.",
		},
		{
			id: "mfa",
			title: "MFA for email, remote access, and admin accounts",
			status: "questionnaire",
			note: "ORPHEUS cannot verify SaaS MFA locally yet. Ask the owner to confirm coverage.",
		},
		{
			id: "backups",
			title: "Encrypted, segregated backups",
			status: "questionnaire",
			note: "ORPHEUS cannot verify backup architecture locally yet. Confirm encryption, separation, and restore tests.",
		},
		{
			id: "incident-response",
			title: "Incident response and recovery plan",
			status: "questionnaire",
			note: "Confirm a written response plan, business continuity plan, and recovery contacts exist.",
		},
	];
}

function buildQuestionnairePrompts(): string[] {
	return [
		"Do you enforce MFA for email, remote access, and administrator accounts?",
		"Do you have encrypted backups that are segregated from the main Windows device or network?",
		"When was the last successful restore test from backup?",
		"Do you have a written incident response and business continuity plan?",
		"Do employees receive recurring security and privacy awareness training?",
		"Do you use a managed EDR or security monitoring provider beyond local Defender?",
	];
}

function buildPromptSuggestions(): PromptSuggestion[] {
	return [
		{
			label: "Explain for owner",
			prompt: "Explain this security report for a non-technical business owner.",
		},
		{
			label: "Client email",
			prompt: "Generate a client-ready remediation email from this report.",
		},
		{
			label: "No-admin fixes",
			prompt: "Show only fixes or reviews that do not require administrator changes.",
		},
		{
			label: "Insurance checklist",
			prompt: "Map this report to cyber insurance readiness controls and list unanswered questions.",
		},
		{
			label: "Export report",
			prompt: "Export this Security Snapshot as a client-ready Markdown report.",
		},
		{
			label: "Follow-up scan",
			prompt: "After I make changes, run a follow-up Security Snapshot and compare before/after.",
		},
	];
}

function buildReportMarkdown(report: Omit<WindowsSecurityReport, "markdown">): string {
	const findingLines =
		report.findings.length > 0
			? report.findings
					.map(
						(finding) =>
							`- **${finding.severity.toUpperCase()} - ${finding.title}** (${finding.category})\n` +
							`  Evidence: ${finding.evidence.slice(0, 500).trim()}\n` +
							`  Risk: ${finding.risk}\n` +
							`  Remediation: ${finding.remediation}`
					)
					.join("\n")
			: "- No findings were produced.";

	const breakdownLines = report.breakdown
		.map((item) => `- ${item.category}: ${item.score}/100 (${item.status}) - ${item.summary}`)
		.join("\n");

	const actionLines =
		report.actions.length > 0
			? report.actions.map((action) => `- **${action.stage}:** ${action.title} - ${action.action}`).join("\n")
			: "- No non-informational remediation steps were generated by the parser.";

	const readinessLines = report.cyberReadinessControls
		.map((control) => `- ${control.title}: ${control.status} - ${control.note}`)
		.join("\n");

	const questionLines = report.questionnairePrompts.map((question) => `- ${question}`).join("\n");
	const suggestionLines = report.promptSuggestions
		.map((suggestion, index) => `${index + 1}. ${suggestion.label}: ${suggestion.prompt}`)
		.join("\n");

	return (
		`# ${report.title}\n\n` +
		`**Score:** ${report.score}/100\n` +
		`**Risk:** ${report.risk}\n\n` +
		`## Executive Summary\n${report.executiveSummary.map((item) => `- ${item}`).join("\n")}\n\n` +
		`## Score Breakdown\n${breakdownLines}\n\n` +
		`## Findings\n${findingLines}\n\n` +
		`## Prioritized Remediation\n${actionLines}\n\n` +
		`## Cyber Readiness Controls\n${readinessLines}\n\n` +
		`## Owner Questions\n${questionLines}\n\n` +
		`## Suggested Follow-up Prompts\n${suggestionLines}\n\n` +
		`## Export\nType \`E\` or \`export report\` to save this Security Snapshot as a client-ready Markdown file.\n\n` +
		`## Privacy Note\nThis report is based on local read-only Windows evidence. ORPHEUS did not intentionally collect credentials, secrets, or document contents.`
	);
}

export function buildWindowsSecurityReport(
	findings: AssessmentFinding[],
	remediationPlan: RemediationStep[],
	options: { title?: string } = {}
): WindowsSecurityReport {
	const reportFindings = findings.map((finding) => ({
		...finding,
		category: categoryForFinding(finding),
	}));
	const penalty = reportFindings.reduce((sum, finding) => sum + SEVERITY_WEIGHTS[finding.severity], 0);
	const score = clampScore(100 - penalty);
	const risk = riskForScore(score);
	const actions = remediationPlan.map((step) => {
		const finding = reportFindings.find((item) => item.id === step.findingId);
		return {
			stage: finding ? actionStageForFinding(finding) : "Watch/review",
			title: step.title,
			action: step.proposedAction,
			findingId: step.findingId,
		};
	});
	const breakdown = buildBreakdown(reportFindings);
	const cyberReadinessControls = buildReadinessControls(reportFindings);
	const questionnairePrompts = buildQuestionnairePrompts();
	const promptSuggestions = buildPromptSuggestions();
	const title = options.title ?? "ORPHEUS Security Snapshot";
	const executiveSummary = buildExecutiveSummary(score, risk, reportFindings, actions);
	const reportWithoutMarkdown = {
		title,
		score,
		risk,
		executiveSummary,
		breakdown,
		findings: reportFindings,
		actions,
		cyberReadinessControls,
		questionnairePrompts,
		promptSuggestions,
	};

	return {
		...reportWithoutMarkdown,
		markdown: buildReportMarkdown(reportWithoutMarkdown),
	};
}
