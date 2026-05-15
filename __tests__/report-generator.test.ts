process.env.ORPHEUS_TEST = "1";

import { describe, expect, it } from "bun:test";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateReport } from "../src/ai/report-generator";

describe("report-generator", () => {
	const testDir = path.join(tmpdir(), "orpheus-report-test");

	it("generates a standalone HTML report with all sections", { timeout: 5000 }, async () => {
		const out = path.join(testDir, "test-report.html");
		const generated = await generateReport(out);
		expect(generated).toBe(out);

		const html = readFileSync(out, "utf8");
		expect(html).toContain("ORPHEUS Executive Dashboard");
		expect(html).toContain("System Health");
		expect(html).toContain("Project Velocity");
		expect(html).toContain("Risk Radar");
		expect(html).toContain("Architecture Map");
		expect(html).toContain("AI ROI Metrics");
		expect(html).toContain("score-ring");
		expect(html).toContain("All data sourced locally");

		try {
			unlinkSync(out);
		} catch {
			/* ignore */
		}
	});

	it("renders gracefully with or without data present", { timeout: 5000 }, async () => {
		const out = path.join(testDir, "minimal-report.html");
		const generated = await generateReport(out);
		const html = readFileSync(generated, "utf8");

		expect(html).toContain("ORPHEUS Executive Dashboard");
		expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
		expect(html).toContain("footer");

		try {
			unlinkSync(out);
		} catch {
			/* ignore */
		}
	});
});
