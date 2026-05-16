import { describe, expect, it } from "bun:test";
import {
	buildRemediationSlaMarkdown,
	defaultDueDateForSeverity,
	evaluateRemediationSla,
	summarizeRemediationSla,
} from "../src/security/remediation-sla";
import type { RemediationLedgerIssue } from "../src/security/security-engagements";

function issue(overrides: Partial<RemediationLedgerIssue> = {}): RemediationLedgerIssue {
	return {
		id: "acme:admin-membership-review",
		clientSlug: "acme",
		findingId: "admin-membership-review",
		title: "Admin membership review",
		severity: "high",
		status: "open",
		dueDate: "2026-05-16T00:00:00.000Z",
		openedAt: "2026-05-09T00:00:00.000Z",
		updatedAt: "2026-05-09T00:00:00.000Z",
		firstSeenAssessmentId: "record-1",
		lastSeenAssessmentId: "record-1",
		evidence: "evidence",
		risk: "risk",
		remediation: "remediation",
		notes: [],
		...overrides,
	};
}

describe("remediation SLA", () => {
	it("assigns default due dates by severity", () => {
		expect(defaultDueDateForSeverity("high", "2026-05-09T00:00:00.000Z")).toBe(
			"2026-05-16T00:00:00.000Z"
		);
		expect(defaultDueDateForSeverity("medium", "2026-05-09T00:00:00.000Z")).toBe(
			"2026-06-08T00:00:00.000Z"
		);
	});

	it("evaluates overdue and due soon states", () => {
		const overdue = evaluateRemediationSla(issue(), new Date("2026-05-20T00:00:00.000Z"));
		const dueSoon = evaluateRemediationSla(issue(), new Date("2026-05-14T00:00:00.000Z"));

		expect(overdue.overdue).toBe(true);
		expect(overdue.overdueDays).toBe(4);
		expect(dueSoon.dueSoon).toBe(true);
		expect(dueSoon.daysUntilDue).toBe(2);
	});

	it("summarizes SLA risk and renders escalation copy", () => {
		const summary = summarizeRemediationSla(
			[
				issue(),
				issue({
					id: "acme:defender-status",
					findingId: "defender-status",
					title: "Defender status",
					severity: "medium",
					status: "verified",
					dueDate: "2026-06-08T00:00:00.000Z",
				}),
			],
			new Date("2026-05-20T00:00:00.000Z")
		);
		const markdown = buildRemediationSlaMarkdown([issue()], new Date("2026-05-20T00:00:00.000Z"));

		expect(summary.overdueCount).toBe(1);
		expect(summary.verifiedCount).toBe(1);
		expect(summary.riskScore).toBe(40);
		expect(markdown).toContain("SLA risk score: 40");
		expect(markdown).toContain("Escalate high remediation");
	});
});
