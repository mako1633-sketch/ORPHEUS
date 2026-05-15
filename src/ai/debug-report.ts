export async function debugReport() {
	const start = Date.now();
	const { generateReport } = await import("./report-generator");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const out = await generateReport(join(tmpdir(), "debug-report.html"));
	console.log("Report took", Date.now() - start, "ms");
	return out;
}
