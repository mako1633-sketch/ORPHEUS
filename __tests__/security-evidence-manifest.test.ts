import { describe, expect, it } from "bun:test";
import { buildSecurityEvidenceManifest, sha256Hex } from "../src/security/security-evidence-manifest";
import { buildWindowsSecurityReport } from "../src/security/windows-security-report";
import type { AssessmentFinding } from "../src/security/windows-assessment-parser";

const finding: AssessmentFinding = {
	id: "assessment-output-collected",
	title: "Assessment evidence collected",
	severity: "info",
	evidence: "evidence",
	risk: "risk",
	remediation: "remediation",
	confidence: "low",
};

describe("security evidence manifest", () => {
	it("hashes command, output preview, and generated artifacts", () => {
		const report = buildWindowsSecurityReport([finding], []);
		const manifest = buildSecurityEvidenceManifest({
			input: {
				clientName: "Acme",
				playbookId: "fullReadOnlyAssessment",
				command: "Get-ComputerInfo",
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
						addedFindingIds: ["assessment-output-collected"],
						resolvedFindingIds: [],
						unchangedFindingIds: [],
					},
				},
			},
			markdown: "# Report",
			markdownPath: "report.md",
			portalHtml: "<html></html>",
			portalPath: "portal.html",
			controlMappings: [],
			generatedAt: new Date("2026-05-09T00:00:00.000Z"),
		});

		expect(sha256Hex("abc")).toHaveLength(64);
		expect(manifest.commandSha256).toBe(sha256Hex("Get-ComputerInfo"));
		expect(manifest.commandOutputPreviewSha256).toBe(sha256Hex("output"));
		expect(manifest.artifacts).toHaveLength(2);
		expect(manifest.artifacts[0]?.sha256).toBe(sha256Hex("# Report"));
	});
});
