import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	listClientEngagements,
	listRemediationLedger,
	syncRemediationLedgerFromAssessment,
	upsertClientEngagement,
} from "../src/security/security-engagements";
import type { WindowsAssessmentRecord } from "../src/security/windows-assessment-history";
import type { AssessmentFinding } from "../src/security/windows-assessment-parser";

const ORIGINAL_ENV = { ...process.env };
let tempDir: string | null = null;

const finding = (id: string, severity: AssessmentFinding["severity"] = "medium"): AssessmentFinding => ({
	id,
	title: id,
	severity,
	evidence: "evidence",
	risk: "risk",
	remediation: "remediation",
	confidence: "high",
});

const record = (id: string, findings: AssessmentFinding[]): WindowsAssessmentRecord => ({
	id,
	createdAt: `2026-05-09T00:00:0${id.slice(-1)}.000Z`,
	playbookId: "fullReadOnlyAssessment",
	clientName: "Acme",
	findings,
});

describe("security engagements", () => {
	afterEach(async () => {
		process.env = { ...ORIGINAL_ENV };
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
			tempDir = null;
		}
	});

	async function useTempStore(): Promise<void> {
		tempDir = await mkdtemp(path.join(os.tmpdir(), "orpheus-engagements-"));
		process.env.ORPHEUS_SECURITY_ENGAGEMENTS_PATH = path.join(tempDir, "engagements.json");
	}

	it("upserts client engagement registry entries", async () => {
		await useTempStore();

		await upsertClientEngagement({ clientName: "Acme", contacts: ["owner@example.com"] });
		await upsertClientEngagement({ clientName: "Acme", riskTier: "high" });
		const clients = await listClientEngagements();

		expect(clients.length).toBe(1);
		expect(clients[0]?.slug).toBe("acme");
		expect(clients[0]?.riskTier).toBe("high");
		expect(clients[0]?.contacts).toEqual(["owner@example.com"]);
	});

	it("opens and verifies remediation ledger issues from assessments", async () => {
		await useTempStore();
		const firstRecord = record("run-1", [finding("a", "high"), finding("b")]);
		const first = await syncRemediationLedgerFromAssessment({
			clientName: "Acme",
			record: firstRecord,
			diff: {
				previousId: null,
				currentId: firstRecord.id,
				addedFindingIds: ["a", "b"],
				resolvedFindingIds: [],
				unchangedFindingIds: [],
			},
			findings: firstRecord.findings,
		});

		const secondRecord = record("run-2", [finding("b")]);
		const second = await syncRemediationLedgerFromAssessment({
			clientName: "Acme",
			record: secondRecord,
			diff: {
				previousId: firstRecord.id,
				currentId: secondRecord.id,
				addedFindingIds: [],
				resolvedFindingIds: ["a"],
				unchangedFindingIds: ["b"],
			},
			findings: secondRecord.findings,
		});
		const ledger = await listRemediationLedger("Acme");

		expect(first.openedIssueIds).toEqual(["acme:a", "acme:b"]);
		expect(second.verifiedIssueIds).toEqual(["acme:a"]);
		expect(second.unchangedIssueIds).toEqual(["acme:b"]);
		expect(ledger.find((issue) => issue.findingId === "a")?.dueDate).toBeDefined();
		expect(ledger.find((issue) => issue.findingId === "b")?.dueDate).toBeDefined();
		expect(ledger.find((issue) => issue.findingId === "a")?.status).toBe("verified");
		expect(ledger.find((issue) => issue.findingId === "b")?.status).toBe("open");
		expect(second.client.riskTier).toBe("medium");
	});
});
