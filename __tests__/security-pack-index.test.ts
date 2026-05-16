import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { updateSecurityPackIndex } from "../src/security/security-pack-index";

describe("security pack index", () => {
	it("writes a client index with links to generated artifacts", async () => {
		const outputDir = await mkdtemp(path.join(os.tmpdir(), "orpheus-pack-index-"));
		const first = await updateSecurityPackIndex({
			outputDir,
			entry: {
				generatedAt: "2026-05-09T12:00:00.000Z",
				clientName: "Acme",
				reportPath: path.join(outputDir, "report.md"),
				portalPath: path.join(outputDir, "portal.html"),
				manifestPath: path.join(outputDir, "manifest.json"),
				assessmentRecordId: "record-1",
				score: 82,
				risk: "Medium",
				findings: 2,
				openIssues: 1,
				overdueIssues: 0,
				verifiedIssues: 1,
			},
		});
		await updateSecurityPackIndex({
			outputDir,
			entry: {
				generatedAt: "2026-05-10T12:00:00.000Z",
				clientName: "Acme",
				reportPath: path.join(outputDir, "report-2.md"),
				portalPath: path.join(outputDir, "portal-2.html"),
				manifestPath: path.join(outputDir, "manifest-2.json"),
				assessmentRecordId: "record-2",
				score: 91,
				risk: "Low",
				findings: 1,
				openIssues: 0,
				overdueIssues: 0,
				verifiedIssues: 2,
			},
		});
		const indexJson = JSON.parse(await readFile(first.indexJsonPath, "utf8")) as {
			entries: Array<{ assessmentRecordId: string }>;
		};
		const html = await readFile(first.indexPath, "utf8");

		expect(indexJson.entries.map((entry) => entry.assessmentRecordId)).toEqual([
			"record-2",
			"record-1",
		]);
		expect(html).toContain("Acme Evidence Pack Index");
		expect(html).toContain("portal-2.html");
		expect(html).toContain("manifest.json");
	});
});
