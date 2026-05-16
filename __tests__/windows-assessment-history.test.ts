import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	diffWindowsAssessmentRecords,
	listWindowsAssessmentHistory,
	saveWindowsAssessmentRecord,
} from "../src/security/windows-assessment-history";
import type { AssessmentFinding } from "../src/security/windows-assessment-parser";

const ORIGINAL_ENV = { ...process.env };
let tempDir: string | null = null;

const finding = (id: string): AssessmentFinding => ({
	id,
	title: id,
	severity: "medium",
	evidence: "evidence",
	risk: "risk",
	remediation: "remediation",
	confidence: "high",
});

describe("Windows assessment history", () => {
	afterEach(async () => {
		process.env = { ...ORIGINAL_ENV };
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
			tempDir = null;
		}
	});

	it("saves records and diffs against the previous assessment", async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "orpheus-assessment-"));
		process.env.ORPHEUS_WINDOWS_ASSESSMENT_HISTORY_PATH = path.join(tempDir, "history.json");

		const first = await saveWindowsAssessmentRecord({
			playbookId: "quickPosture",
			findings: [finding("a")],
		});
		const second = await saveWindowsAssessmentRecord({
			playbookId: "quickPosture",
			findings: [finding("a"), finding("b")],
		});
		const history = await listWindowsAssessmentHistory();

		expect(first.diff.previousId).toBeNull();
		expect(second.diff.addedFindingIds).toEqual(["b"]);
		expect(history.length).toBe(2);
	});

	it("diffs client-scoped records against the previous run for the same client", async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "orpheus-assessment-client-"));
		process.env.ORPHEUS_WINDOWS_ASSESSMENT_HISTORY_PATH = path.join(tempDir, "history.json");

		await saveWindowsAssessmentRecord({
			playbookId: "quickPosture",
			clientName: "Other Client",
			findings: [finding("other")],
		});
		const firstClientRun = await saveWindowsAssessmentRecord({
			playbookId: "quickPosture",
			clientName: "Acme",
			findings: [finding("a")],
		});
		const secondClientRun = await saveWindowsAssessmentRecord({
			playbookId: "quickPosture",
			clientName: "Acme",
			findings: [finding("a"), finding("b")],
		});

		expect(firstClientRun.diff.previousId).toBeNull();
		expect(secondClientRun.diff.addedFindingIds).toEqual(["b"]);
		expect(secondClientRun.diff.unchangedFindingIds).toEqual(["a"]);
	});

	it("computes resolved and unchanged findings", () => {
		const previous = {
			id: "old",
			createdAt: "2026-01-01T00:00:00.000Z",
			playbookId: "quickPosture",
			findings: [finding("a"), finding("b")],
		};
		const current = {
			id: "new",
			createdAt: "2026-01-02T00:00:00.000Z",
			playbookId: "quickPosture",
			findings: [finding("b"), finding("c")],
		};

		expect(diffWindowsAssessmentRecords(current, previous)).toMatchObject({
			addedFindingIds: ["c"],
			resolvedFindingIds: ["a"],
			unchangedFindingIds: ["b"],
		});
	});
});
