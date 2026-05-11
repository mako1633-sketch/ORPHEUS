import type { AssessmentFinding } from "./windows-assessment-parser";

export interface RemediationStep {
	findingId: string;
	title: string;
	riskLevel: AssessmentFinding["severity"];
	proposedAction: string;
	approvalRequired: true;
	rollback: string;
}

export function buildWindowsRemediationPlan(findings: AssessmentFinding[]): RemediationStep[] {
	return findings
		.filter((finding) => finding.severity !== "info")
		.map((finding) => ({
			findingId: finding.id,
			title: finding.title,
			riskLevel: finding.severity,
			proposedAction: finding.remediation,
			approvalRequired: true,
			rollback:
				"Record the original setting before changing it; if the change causes issues, restore that prior setting or policy.",
		}));
}
