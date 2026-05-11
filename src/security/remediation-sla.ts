import type { RemediationLedgerIssue } from "./security-engagements";
import type { AssessmentFinding } from "./windows-assessment-parser";

export const SLA_DAYS_BY_SEVERITY: Record<AssessmentFinding["severity"], number> = {
	high: 7,
	medium: 30,
	low: 60,
	info: 90,
};

export interface RemediationSlaState {
	issueId: string;
	title: string;
	severity: AssessmentFinding["severity"];
	status: RemediationLedgerIssue["status"];
	openedAt: string;
	dueDate: string;
	ageDays: number;
	daysUntilDue: number;
	overdue: boolean;
	overdueDays: number;
	dueSoon: boolean;
	escalation: string;
}

export interface RemediationSlaSummary {
	totalTracked: number;
	activeCount: number;
	overdueCount: number;
	dueSoonCount: number;
	highOverdueCount: number;
	acceptedRiskCount: number;
	verifiedCount: number;
	riskScore: number;
	states: RemediationSlaState[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = new Set<RemediationLedgerIssue["status"]>(["open", "in-progress", "fixed"]);

function parseDate(value: string | undefined, fallback: Date): Date {
	if (!value) return fallback;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function fullDaysBetween(start: Date, end: Date): number {
	return Math.floor((end.getTime() - start.getTime()) / DAY_MS);
}

export function defaultDueDateForSeverity(
	severity: AssessmentFinding["severity"],
	openedAt: string | Date
): string {
	const opened = typeof openedAt === "string" ? parseDate(openedAt, new Date()) : openedAt;
	const due = new Date(opened.getTime() + SLA_DAYS_BY_SEVERITY[severity] * DAY_MS);
	return due.toISOString();
}

function effectiveDueDate(issue: RemediationLedgerIssue): string {
	if (issue.status === "accepted-risk" && issue.acceptedRiskExpiresAt) return issue.acceptedRiskExpiresAt;
	return issue.dueDate ?? defaultDueDateForSeverity(issue.severity, issue.openedAt);
}

function isActiveForSla(issue: RemediationLedgerIssue): boolean {
	if (issue.status === "verified") return false;
	if (issue.status === "accepted-risk") return Boolean(issue.acceptedRiskExpiresAt);
	return ACTIVE_STATUSES.has(issue.status);
}

function severityWeight(severity: AssessmentFinding["severity"]): number {
	if (severity === "high") return 10;
	if (severity === "medium") return 5;
	if (severity === "low") return 2;
	return 1;
}

export function buildRemediationEscalationText(issue: RemediationLedgerIssue, now = new Date()): string {
	const state = evaluateRemediationSla(issue, now);
	if (issue.status === "verified") return "Verified resolved; no escalation required.";
	if (issue.status === "accepted-risk" && !state.overdue) {
		return `Accepted risk review due by ${state.dueDate}. Confirm continued acceptance or reopen remediation.`;
	}
	if (state.overdue) {
		return `Escalate ${issue.severity} remediation: ${issue.title} is ${state.overdueDays} day(s) overdue. Owner: ${issue.owner ?? "unassigned"}.`;
	}
	if (state.dueSoon) {
		return `Due soon: ${issue.title} is due in ${state.daysUntilDue} day(s). Confirm owner and remediation window.`;
	}
	return `On track: ${issue.title} is due by ${state.dueDate}.`;
}

export function evaluateRemediationSla(issue: RemediationLedgerIssue, now = new Date()): RemediationSlaState {
	const opened = parseDate(issue.openedAt, now);
	const due = parseDate(effectiveDueDate(issue), opened);
	const active = isActiveForSla(issue);
	const ageDays = Math.max(0, fullDaysBetween(opened, now));
	const daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / DAY_MS);
	const overdueDays = active ? Math.max(0, Math.floor((now.getTime() - due.getTime()) / DAY_MS)) : 0;
	const overdue = overdueDays > 0;
	const dueSoon = active && !overdue && daysUntilDue <= 7;

	return {
		issueId: issue.id,
		title: issue.title,
		severity: issue.severity,
		status: issue.status,
		openedAt: issue.openedAt,
		dueDate: due.toISOString(),
		ageDays,
		daysUntilDue,
		overdue,
		overdueDays,
		dueSoon,
		escalation: "",
	};
}

export function summarizeRemediationSla(
	issues: RemediationLedgerIssue[] = [],
	now = new Date()
): RemediationSlaSummary {
	const states = issues.map((issue) => {
		const state = evaluateRemediationSla(issue, now);
		return { ...state, escalation: buildRemediationEscalationText(issue, now) };
	});
	const activeStates = states.filter((state) => state.status !== "verified");
	const overdueStates = states.filter((state) => state.overdue);

	return {
		totalTracked: states.length,
		activeCount: activeStates.filter((state) => state.status !== "accepted-risk").length,
		overdueCount: overdueStates.length,
		dueSoonCount: states.filter((state) => state.dueSoon).length,
		highOverdueCount: overdueStates.filter((state) => state.severity === "high").length,
		acceptedRiskCount: states.filter((state) => state.status === "accepted-risk").length,
		verifiedCount: states.filter((state) => state.status === "verified").length,
		riskScore: overdueStates.reduce(
			(total, state) => total + severityWeight(state.severity) * Math.max(1, state.overdueDays),
			0
		),
		states,
	};
}

export function buildRemediationSlaMarkdown(issues: RemediationLedgerIssue[] = [], now = new Date()): string {
	const summary = summarizeRemediationSla(issues, now);
	if (summary.totalTracked === 0) return "- No remediation SLA items are currently tracked.";

	const rows = summary.states
		.map((state) => {
			const dueLabel = state.overdue
				? `${state.overdueDays} day(s) overdue`
				: state.status === "verified"
					? "resolved"
					: `${state.daysUntilDue} day(s) remaining`;
			return `- ${state.issueId}: ${state.status} / ${state.severity} - age ${state.ageDays} day(s), due ${state.dueDate} (${dueLabel}). ${state.escalation}`;
		})
		.join("\n");

	return [
		`- Active issues: ${summary.activeCount}`,
		`- Overdue issues: ${summary.overdueCount}`,
		`- Due within 7 days: ${summary.dueSoonCount}`,
		`- High severity overdue: ${summary.highOverdueCount}`,
		`- Accepted risks pending review: ${summary.acceptedRiskCount}`,
		`- SLA risk score: ${summary.riskScore}`,
		"",
		rows,
	].join("\n");
}
