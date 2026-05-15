import { describe, expect, it } from "bun:test";
import { buildSecurityControlMappings } from "../src/security/security-control-mapping";
import { buildSecurityPortalHtml } from "../src/security/security-portal";
import type { AssessmentFinding } from "../src/security/windows-assessment-parser";
import { buildWindowsSecurityReport } from "../src/security/windows-security-report";

const finding: AssessmentFinding = {
	id: "admin-membership-review",
	title: "Local administrator membership needs review",
	severity: "medium",
	evidence: "evidence",
	risk: "risk",
	remediation: "remediation",
	confidence: "high",
};

describe("security portal", () => {
	it("renders an executive HTML dashboard", () => {
		const report = buildWindowsSecurityReport([finding], []);
		const controlMappings = buildSecurityControlMappings([finding], report);
		const html = buildSecurityPortalHtml({
			input: {
				clientName: "Acme",
				playbookId: "fullReadOnlyAssessment",
				command: "command",
				commandOutput: "output",
				findings: [finding],
				remediationPlan: [],
				report,
				history: {
					record: {
						id: "record-1",
						createdAt: "2026-05-09T00:00:00.000Z",
						playbookId: "fullReadOnlyAssessment",
						findings: [finding],
					},
					diff: {
						previousId: null,
						currentId: "record-1",
						addedFindingIds: ["admin-membership-review"],
						resolvedFindingIds: [],
						unchangedFindingIds: [],
					},
				},
			},
			controlMappings,
			generatedAt: new Date("2026-05-09T00:00:00.000Z"),
		});

		expect(html).toContain("Acme Security Engagement Portal");
		expect(html).toContain("Control Map");
		expect(html).toContain("Remediation Ledger");
		expect(html).toContain("Evidence Manifest");
		expect(html).toContain("<!doctype html>");
	});
});
