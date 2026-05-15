import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	buildSecurityEvidencePackMarkdown,
	exportSecurityEvidencePack,
} from "../src/security/security-evidence-pack";
import type { WindowsAssessmentRecord } from "../src/security/windows-assessment-history";
import type { AssessmentFinding } from "../src/security/windows-assessment-parser";
import { buildWindowsRemediationPlan } from "../src/security/windows-remediation";
import { buildWindowsSecurityReport } from "../src/security/windows-security-report";

const finding = (id: string): AssessmentFinding => ({
	id,
	title: id,
	severity: "medium",
	evidence: "evidence",
	risk: "risk",
	remediation: "remediation",
	confidence: "high",
});

function packInput(outputDir?: string) {
	const findings = [finding("admin-membership-review")];
	const remediationPlan = buildWindowsRemediationPlan(findings);
	const report = buildWindowsSecurityReport(findings, remediationPlan, {
		title: "Acme ORPHEUS Security Snapshot",
	});
	const record: WindowsAssessmentRecord = {
		id: "record-1",
		createdAt: "2026-05-09T00:00:00.000Z",
		playbookId: "fullReadOnlyAssessment",
		clientName: "Acme",
		findings,
	};

	return {
		input: {
			clientName: "Acme",
			playbookId: "fullReadOnlyAssessment" as const,
			command: "Write-Output '### Local administrators'",
			commandOutput: "### Local administrators\nAdmin",
			findings,
			remediationPlan,
			report,
			history: {
				record,
				diff: {
					previousId: null,
					currentId: record.id,
					addedFindingIds: ["admin-membership-review"],
					resolvedFindingIds: [],
					unchangedFindingIds: [],
				},
			},
			engagement: {
				id: "client-1",
				clientName: "Acme",
				slug: "acme",
				status: "active" as const,
				riskTier: "medium" as const,
				contacts: [],
				environmentNotes: [],
				createdAt: "2026-05-09T00:00:00.000Z",
				updatedAt: "2026-05-09T00:00:00.000Z",
				lastAssessmentAt: "2026-05-09T00:00:00.000Z",
			},
			ledger: [
				{
					id: "acme:admin-membership-review",
					clientSlug: "acme",
					findingId: "admin-membership-review",
					title: "admin-membership-review",
					severity: "medium" as const,
					status: "open" as const,
					dueDate: "2026-06-08T00:00:00.000Z",
					openedAt: "2026-05-09T00:00:00.000Z",
					updatedAt: "2026-05-09T00:00:00.000Z",
					firstSeenAssessmentId: "record-1",
					lastSeenAssessmentId: "record-1",
					evidence: "evidence",
					risk: "risk",
					remediation: "remediation",
					notes: [],
				},
			],
			ledgerSync: {
				openedIssueIds: ["acme:admin-membership-review"],
				verifiedIssueIds: [],
				unchangedIssueIds: [],
			},
			generatedAt: new Date("2026-05-09T12:34:56.000Z"),
		},
		outputDir,
	};
}

describe("security evidence pack", () => {
	it("builds a client-ready managed evidence pack", () => {
		const { input } = packInput();
		const markdown = buildSecurityEvidencePackMarkdown(input);

		expect(markdown).toContain("# Managed Security Evidence Pack");
		expect(markdown).toContain("Client: Acme");
		expect(markdown).toContain("## Executive Security Snapshot");
		expect(markdown).toContain("## Client Engagement Registry");
		expect(markdown).toContain("## Before/After Delta");
		expect(markdown).toContain("## Technical Findings Appendix");
		expect(markdown).toContain("## Remediation Tracker");
		expect(markdown).toContain("## Remediation Ledger");
		expect(markdown).toContain("## Remediation SLA");
		expect(markdown).toContain("acme:admin-membership-review");
		expect(markdown).toContain("## Control Mapping");
		expect(markdown).toContain("## Scheduled Task Verification");
		expect(markdown).toContain("## Evidence Bundle Manifest");
		expect(markdown).toContain("Control mappings:");
		expect(markdown).toContain("Get-ScheduledTask -TaskPath");
	});

	it("exports an evidence pack under a client-specific path", async () => {
		const outputDir = await mkdtemp(path.join(os.tmpdir(), "orpheus-evidence-pack-"));
		const { input } = packInput(outputDir);
		const exported = await exportSecurityEvidencePack(input, { outputDir });
		const contents = await readFile(exported.path, "utf8");
		const manifest = JSON.parse(await readFile(exported.manifestPath, "utf8")) as {
			artifacts: Array<{ path: string; sha256: string }>;
		};
		const portal = await readFile(exported.portalPath, "utf8");
		const indexHtml = await readFile(exported.indexPath, "utf8");
		const indexJson = JSON.parse(await readFile(exported.indexJsonPath, "utf8")) as {
			entries: Array<{ score: number; openIssues: number; overdueIssues: number }>;
		};

		expect(exported.path).toEndWith("acme-evidence-pack-20260509T123456Z.md");
		expect(exported.portalPath).toEndWith("acme-executive-portal-20260509T123456Z.html");
		expect(exported.manifestPath).toEndWith("acme-evidence-manifest-20260509T123456Z.json");
		expect(exported.indexPath).toEndWith("index.html");
		expect(exported.indexJsonPath).toEndWith("index.json");
		expect(contents).toContain("Client: Acme");
		expect(contents).toContain("Assessment command used:");
		expect(portal).toContain("Acme Security Engagement Portal");
		expect(portal).toContain("Overdue SLA Items");
		expect(indexHtml).toContain("Acme Evidence Pack Index");
		expect(indexHtml).toContain("acme-executive-portal-20260509T123456Z.html");
		expect(indexJson.entries[0]?.openIssues).toBe(1);
		expect(indexJson.entries[0]?.overdueIssues).toBe(0);
		expect(manifest.artifacts.length).toBeGreaterThanOrEqual(2);
		expect(manifest.artifacts[0]?.sha256).toHaveLength(64);
	});
});
