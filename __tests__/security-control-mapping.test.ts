import { describe, expect, it } from "bun:test";
import { buildSecurityControlMappings } from "../src/security/security-control-mapping";
import type { AssessmentFinding } from "../src/security/windows-assessment-parser";
import { buildWindowsSecurityReport } from "../src/security/windows-security-report";

const finding = (
	id: string,
	title: string,
	severity: AssessmentFinding["severity"]
): AssessmentFinding => ({
	id,
	title,
	severity,
	evidence: "evidence",
	risk: "risk",
	remediation: "remediation",
	confidence: "high",
});

describe("security control mapping", () => {
	it("maps Windows findings to control statuses and insurance unknowns", () => {
		const findings = [
			finding(
				"defender-realtime-disabled",
				"Defender real-time protection appears disabled",
				"high"
			),
			finding("admin-membership-review", "Local administrator membership needs review", "medium"),
		];
		const report = buildWindowsSecurityReport(findings, []);
		const mappings = buildSecurityControlMappings(findings, report);

		expect(mappings.map((mapping) => mapping.id)).toContain("cis-10-malware-defenses");
		expect(mappings.find((mapping) => mapping.id === "cis-10-malware-defenses")?.status).toBe(
			"failed"
		);
		expect(mappings.find((mapping) => mapping.id === "insurance-mfa")?.status).toBe("unknown");
		expect(
			mappings.some((mapping) => mapping.relatedFindingIds.includes("admin-membership-review"))
		).toBe(true);
	});
});
