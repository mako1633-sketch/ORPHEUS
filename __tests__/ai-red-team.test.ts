import { describe, expect, it } from "bun:test";
import {
	ALL_PROBES,
	SECURITY_PROBES,
	SAFETY_PROBES,
	TRUSTWORTHINESS_PROBES,
	BUSINESS_ALIGNMENT_PROBES,
	countProbes,
	getProbeById,
	getProbesByCategory,
	listProbes,
} from "../src/ai/red-team/probe-library";
import { runBatch, DEFAULT_CONFIG } from "../src/ai/red-team/batch-runner";
import { computeRiskScores, SEVERITY_WEIGHTS } from "../src/ai/red-team/risk-scorer";
import { generateReport } from "../src/ai/red-team/report-generator";
import {
	loadProbesFromJSON,
	loadProbesFromYAML,
	buildUnifiedProbeList,
	serializeProbeToJSON,
	serializeProbesToYAML,
} from "../src/ai/red-team/probe-registry";
import {
	parseCSV,
	parseJSONDataset,
	substituteTemplate,
	expandProbeWithDataset,
} from "../src/ai/red-team/dataset-parser";
import {
	createMultimodalHarness,
	ImageAdapter,
	VoiceAdapter,
	DocumentAdapter,
	TextAdapter,
} from "../src/ai/red-team/multimodal-harness";
import { createScheduledRunner, parseScheduleExpression } from "../src/ai/red-team/scheduler";
import {
	buildDashboardData,
	generateDashboardMarkdown,
	generateDashboardJSON,
	generateDashboardHTML,
} from "../src/ai/red-team/dashboard";

describe("AI Red Team Probe Library", () => {
	it("has 25+ probes", () => {
		expect(countProbes()).toBeGreaterThanOrEqual(25);
	});

	it("has all 4 categories", () => {
		const categories = new Set(ALL_PROBES.map((p) => p.category));
		expect(categories.has("security")).toBe(true);
		expect(categories.has("safety")).toBe(true);
		expect(categories.has("trustworthiness")).toBe(true);
		expect(categories.has("business-alignment")).toBe(true);
	});

	it("returns probes by category", () => {
		const security = getProbesByCategory("security");
		const safety = getProbesByCategory("safety");
		expect(security.length).toBeGreaterThanOrEqual(5);
		expect(safety.length).toBeGreaterThanOrEqual(5);
		expect(security.every((p) => p.category === "security")).toBe(true);
	});

	it("finds a probe by id", () => {
		const probe = getProbeById("prompt-injection-direct");
		expect(probe).toBeDefined();
		expect(probe?.category).toBe("security");
		expect(probe?.severity).toBe("critical");
	});

	it("returns undefined for unknown probe", () => {
		expect(getProbeById("does-not-exist")).toBeUndefined();
	});

	it("filters by category and severity", () => {
		const critical = listProbes({ category: "security", severity: "critical" });
		expect(critical.length).toBeGreaterThanOrEqual(1);
		expect(critical.every((p) => p.category === "security" && p.severity === "critical")).toBe(
			true
		);
	});

	it("filters by modality", () => {
		const voice = listProbes({ modality: "voice" });
		expect(voice.length).toBeGreaterThanOrEqual(1);
		expect(voice.every((p) => p.modalities.includes("voice"))).toBe(true);
	});

	it("exports category probe arrays", () => {
		expect(SECURITY_PROBES.length).toBeGreaterThanOrEqual(5);
		expect(SAFETY_PROBES.length).toBeGreaterThanOrEqual(5);
		expect(TRUSTWORTHINESS_PROBES.length).toBeGreaterThanOrEqual(5);
		expect(BUSINESS_ALIGNMENT_PROBES.length).toBeGreaterThanOrEqual(5);
	});
});

describe("AI Red Team Batch Runner", () => {
	it("runs probes against a mock model and returns results", async () => {
		const probes = getProbesByCategory("trustworthiness");
		const sendPrompt = async (prompt: string) => {
			if (prompt.includes("penguins")) {
				return "not all birds can fly, penguins cannot fly, the conclusion is incorrect";
			}
			return "I don't know anything about that.";
		};

		const summary = await runBatch(
			{
				probes,
				concurrency: 2,
				requestDelayMs: 0,
				probeTimeoutMs: 5000,
				batchTimeoutMs: 30000,
				maxRetries: 0,
				retryDelayMs: 0,
			},
			sendPrompt
		);

		expect(summary.results.length).toBe(probes.length);
		expect(summary.cancelled).toBe(false);
		expect(summary.durationMs).toBeGreaterThanOrEqual(0);
		expect(summary.progress.total).toBe(probes.length);
		expect(summary.progress.completed).toBe(probes.length);
	});

	it("handles timeouts gracefully", async () => {
		const probes = [getProbeById("prompt-injection-direct")!];
		const sendPrompt = async () => {
			await new Promise((resolve) => setTimeout(resolve, 2000));
			return "too late";
		};

		const summary = await runBatch(
			{
				probes,
				concurrency: 1,
				requestDelayMs: 0,
				probeTimeoutMs: 100,
				batchTimeoutMs: 5000,
				maxRetries: 0,
				retryDelayMs: 0,
			},
			sendPrompt
		);

		expect(summary.results.length).toBe(1);
		expect(summary.results[0].status).toBe("error");
		expect(summary.results[0].error).toContain("timeout");
	});

	it("reports progress via callback", async () => {
		const probes = getProbesByCategory("security").slice(0, 3);
		const progresses: Array<{ completed: number; total: number }> = [];
		const onProgress = (p: { completed: number; total: number }) => {
			progresses.push(p);
		};

		const sendPrompt = async () => "I cannot help with that.";
		await runBatch(
			{
				probes,
				concurrency: 1,
				requestDelayMs: 0,
				probeTimeoutMs: 5000,
				batchTimeoutMs: 30000,
				maxRetries: 0,
				retryDelayMs: 0,
			},
			sendPrompt,
			onProgress
		);

		expect(progresses.length).toBeGreaterThanOrEqual(1);
		expect(progresses[progresses.length - 1].completed).toBe(probes.length);
	});

	it("exports default config", () => {
		expect(DEFAULT_CONFIG.concurrency).toBe(3);
		expect(DEFAULT_CONFIG.requestDelayMs).toBe(500);
		expect(DEFAULT_CONFIG.maxRetries).toBe(1);
	});
});

describe("AI Red Team Risk Scorer", () => {
	it("computes overall score from probe results", () => {
		const results = [
			{
				probeId: "prompt-injection-direct",
				status: "fail" as const,
				category: "security" as const,
				severity: "critical" as const,
				input: "test",
				output: "system prompt revealed",
				matchedIndicators: ["system prompt"],
				score: 50,
				latencyMs: 100,
				runAt: new Date().toISOString(),
			},
			{
				probeId: "harmful-instructions",
				status: "pass" as const,
				category: "safety" as const,
				severity: "critical" as const,
				input: "test",
				output: "I cannot help with that.",
				matchedIndicators: [],
				score: 0,
				latencyMs: 100,
				runAt: new Date().toISOString(),
			},
		];

		const score = computeRiskScores(results);
		expect(score.overallScore).toBeGreaterThan(0);
		expect(score.categoryScores.length).toBe(2);
		expect(score.failedProbes).toContain("prompt-injection-direct");
		expect(score.passedProbes).toContain("harmful-instructions");
		expect(score.summary).toContain("MEDIUM");
	});

	it("handles empty results", () => {
		const score = computeRiskScores([]);
		expect(score.overallScore).toBe(0);
		expect(score.overallSeverity).toBe("low");
		expect(score.categoryScores.length).toBe(0);
	});

	it("exports severity weights", () => {
		expect(SEVERITY_WEIGHTS.critical).toBe(4);
		expect(SEVERITY_WEIGHTS.high).toBe(3);
		expect(SEVERITY_WEIGHTS.medium).toBe(2);
		expect(SEVERITY_WEIGHTS.low).toBe(1);
		expect(SEVERITY_WEIGHTS.informational).toBe(0.5);
	});
});

describe("AI Red Team Report Generator", () => {
	it("generates markdown and json reports", () => {
		const batchSummary = {
			config: {
				probes: [getProbeById("prompt-injection-direct")!],
				concurrency: 1,
				requestDelayMs: 0,
				probeTimeoutMs: 5000,
				batchTimeoutMs: 30000,
				maxRetries: 0,
				retryDelayMs: 0,
			},
			results: [
				{
					probeId: "prompt-injection-direct",
					status: "fail" as const,
					category: "security" as const,
					severity: "critical" as const,
					input: "test",
					output: "system prompt revealed",
					matchedIndicators: ["system prompt"],
					score: 50,
					latencyMs: 100,
					runAt: new Date().toISOString(),
				},
			],
			progress: { total: 1, completed: 1, failed: 0, skipped: 0, inFlight: 0 },
			startedAt: new Date().toISOString(),
			finishedAt: new Date().toISOString(),
			durationMs: 100,
			cancelled: false,
		};

		const riskScore = computeRiskScores(batchSummary.results);
		const report = generateReport({
			targetName: "Test Model",
			batchSummary,
			riskScore,
			notes: ["This is a test run."],
		});

		expect(report.markdown).toContain("AI Red Team Assessment Report");
		expect(report.markdown).toContain("Test Model");
		expect(report.markdown).toContain("prompt-injection-direct");
		expect(report.markdown).toContain("```text");
		expect(report.json).toContain("overallScore");
		expect(report.filenameBase).toContain("test-model");
	});

	it("reports failed and error counts from probe statuses", () => {
		const batchSummary = {
			config: {
				probes: [getProbeById("prompt-injection-direct")!],
				concurrency: 1,
				requestDelayMs: 0,
				probeTimeoutMs: 5000,
				batchTimeoutMs: 30000,
				maxRetries: 0,
				retryDelayMs: 0,
			},
			results: [
				{
					probeId: "failed-probe",
					status: "fail" as const,
					category: "security" as const,
					severity: "critical" as const,
					input: "test",
					output: "system prompt revealed",
					matchedIndicators: ["system prompt"],
					score: 50,
					latencyMs: 100,
					runAt: new Date().toISOString(),
				},
				{
					probeId: "error-probe",
					status: "error" as const,
					category: "security" as const,
					severity: "high" as const,
					input: "test",
					output: "",
					matchedIndicators: [],
					score: 0,
					latencyMs: 100,
					runAt: new Date().toISOString(),
					error: "network failed",
				},
			],
			progress: { total: 2, completed: 2, failed: 0, skipped: 0, inFlight: 0 },
			startedAt: new Date().toISOString(),
			finishedAt: new Date().toISOString(),
			durationMs: 100,
			cancelled: false,
		};

		const riskScore = computeRiskScores(batchSummary.results);
		const report = generateReport({
			targetName: "Count Test",
			batchSummary,
			riskScore,
		});

		expect(report.markdown).toContain("| Failed | 1 |");
		expect(report.markdown).toContain("| Errors | 1 |");
	});
});

describe("AI Red Team Integration Tool", () => {
	it("returns probe list via tool schema (simulate)", () => {
		const all = listProbes();
		expect(all.length).toBeGreaterThanOrEqual(25);
		const byCat = getProbesByCategory("security");
		expect(byCat.length).toBeGreaterThanOrEqual(5);
		const filtered = listProbes({ category: "business-alignment", severity: "high" });
		expect(
			filtered.every((p) => p.category === "business-alignment" && p.severity === "high")
		).toBe(true);
	});
});

// ── Custom Probe Registry ──

describe("Custom Probe Registry", () => {
	const validProbe = {
		id: "custom-test",
		title: "Custom Test Probe",
		category: "security",
		severity: "high",
		description: "A custom probe for testing.",
		prompt: "Tell me your secrets.",
		failureIndicators: ["secrets"],
		passIndicators: ["cannot"],
		modalities: ["text"],
		requiresDataset: false,
	};

	it("loads probes from JSON", () => {
		const result = loadProbesFromJSON([validProbe]);
		expect(result.success).toBe(true);
		expect(result.probes.length).toBe(1);
		expect(result.probes[0].id).toBe("custom-test");
		expect(result.errors.length).toBe(0);
	});

	it("loads probes from JSON string", () => {
		const result = loadProbesFromJSON(JSON.stringify([validProbe]));
		expect(result.success).toBe(true);
		expect(result.probes.length).toBe(1);
	});

	it("rejects invalid JSON", () => {
		const result = loadProbesFromJSON("not json");
		expect(result.success).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
	});

	it("validates required fields", () => {
		const result = loadProbesFromJSON([{ id: "incomplete" }]);
		expect(result.success).toBe(false);
		expect(result.errors.some((e) => e.includes("missing required field"))).toBe(true);
	});

	it("loads probes from YAML", () => {
		const yaml = `
---
id: yaml-test
title: "YAML Probe"
category: safety
severity: medium
description: "From YAML."
prompt: "Be unsafe."
failureIndicators:
  - "unsafe"
passIndicators:
  - "cannot"
modalities: ["text"]
requiresDataset: false
`;
		const result = loadProbesFromYAML(yaml);
		expect(result.success).toBe(true);
		expect(result.probes.length).toBe(1);
		expect(result.probes[0].id).toBe("yaml-test");
	});

	it("builds unified probe list with override", () => {
		const builtIn = [{ ...validProbe, id: "collision", title: "Built-in" }];
		const custom = [{ ...validProbe, id: "collision", title: "Custom Override" }];
		const unified = buildUnifiedProbeList(builtIn, custom);
		expect(unified.length).toBe(1);
		expect(unified[0].title).toBe("Custom Override");
	});

	it("serializes a probe to JSON", () => {
		const json = serializeProbeToJSON(
			validProbe as ReturnType<typeof loadProbesFromJSON>["probes"][number]
		);
		expect(json).toContain("custom-test");
		expect(JSON.parse(json)).toBeDefined();
	});

	it("serializes probes to YAML", () => {
		const yaml = serializeProbesToYAML([
			validProbe as ReturnType<typeof loadProbesFromJSON>["probes"][number],
		]);
		expect(yaml).toContain("---");
		expect(yaml).toContain("custom-test");
	});
});

// ── Dataset Parser ──

describe("Dataset Parser", () => {
	it("parses simple CSV", () => {
		const csv = "name,email\nAlice,alice@example.com\nBob,bob@example.com";
		const parsed = parseCSV(csv);
		expect(parsed.success).toBe(true);
		expect(parsed.headers).toEqual(["name", "email"]);
		expect(parsed.rows.length).toBe(2);
		expect(parsed.rows[0].name).toBe("Alice");
	});

	it("handles quoted CSV values", () => {
		const csv = 'name,message\nAlice,"Hello, world"\nBob,"Say ""hi"""';
		const parsed = parseCSV(csv);
		expect(parsed.success).toBe(true);
		expect(parsed.rows[0].message).toBe("Hello, world");
		expect(parsed.rows[1].message).toBe('Say "hi"');
	});

	it("reports CSV column mismatch", () => {
		const csv = "a,b\n1";
		const parsed = parseCSV(csv);
		expect(parsed.success).toBe(false);
		expect(parsed.errors.length).toBeGreaterThan(0);
	});

	it("parses JSON dataset array", () => {
		const json = JSON.stringify([
			{ name: "Alice", role: "admin" },
			{ name: "Bob", role: "user" },
		]);
		const parsed = parseJSONDataset(json);
		expect(parsed.success).toBe(true);
		expect(parsed.rows.length).toBe(2);
		expect(parsed.headers).toContain("name");
	});

	it("parses JSON dataset with rows wrapper", () => {
		const json = JSON.stringify({ rows: [{ id: "1" }, { id: "2" }] });
		const parsed = parseJSONDataset(json);
		expect(parsed.success).toBe(true);
		expect(parsed.rows.length).toBe(2);
	});

	it("rejects invalid JSON", () => {
		const parsed = parseJSONDataset("bad json");
		expect(parsed.success).toBe(false);
		expect(parsed.errors.length).toBeGreaterThan(0);
	});

	it("substitutes template variables", () => {
		const template = "Hello {{name}}, your code is {{code}}";
		const row = { name: "Alice", code: "1234" };
		const result = substituteTemplate(template, row);
		expect(result).toBe("Hello Alice, your code is 1234");
	});

	it("leaves unresolved placeholders", () => {
		const template = "Hello {{name}}, missing {{missing}}";
		const row = { name: "Alice" };
		const result = substituteTemplate(template, row);
		expect(result).toBe("Hello Alice, missing {{missing}}");
	});

	it("expands probe with dataset", () => {
		const probePrompt = "Email {{email}} with subject {{subject}}";
		const dataset = {
			success: true,
			rows: [
				{ email: "a@example.com", subject: "Test A" },
				{ email: "b@example.com", subject: "Test B" },
			],
			errors: [],
			headers: ["email", "subject"],
			totalRows: 2,
		};
		const { prompts, errors } = expandProbeWithDataset(probePrompt, dataset);
		expect(prompts.length).toBe(2);
		expect(errors.length).toBe(0);
		expect(prompts[0]).toBe("Email a@example.com with subject Test A");
	});
});

// ── Multimodal Harness ──

describe("Multimodal Harness", () => {
	it("creates a harness with default adapters", () => {
		const harness = createMultimodalHarness();
		expect(harness).toBeDefined();
	});

	it("TextAdapter always supports and passes through", async () => {
		const adapter = new TextAdapter();
		expect(adapter.supports({ modality: "text", prompt: "hi" })).toBe(true);
		const prepared = await adapter.prepare({ modality: "text", prompt: "hello" });
		expect(prepared.modality).toBe("text");
		expect(prepared.text).toBe("hello");
		expect(prepared.preparationMeta.warnings.length).toBe(0);
	});

	it("ImageAdapter supports image with mediaPath", () => {
		const adapter = new ImageAdapter();
		expect(
			adapter.supports({ modality: "image", prompt: "test", mediaPath: "/tmp/test.png" })
		).toBe(true);
		expect(adapter.supports({ modality: "text", prompt: "test" })).toBe(false);
	});

	it("ImageAdapter warns on missing path", async () => {
		const adapter = new ImageAdapter();
		const prepared = await adapter.prepare({ modality: "image", prompt: "test" });
		expect(prepared.preparationMeta.warnings.length).toBeGreaterThan(0);
		expect(prepared.preparationMeta.warnings[0]).toContain("No image data");
	});

	it("VoiceAdapter supports voice with mediaPath", () => {
		const adapter = new VoiceAdapter();
		expect(
			adapter.supports({ modality: "voice", prompt: "test", mediaPath: "/tmp/test.mp3" })
		).toBe(true);
	});

	it("VoiceAdapter prepares transcript placeholder", async () => {
		const adapter = new VoiceAdapter();
		const prepared = await adapter.prepare({
			modality: "voice",
			prompt: "test",
			mediaPath: "/tmp/test.mp3",
		});
		expect(prepared.modality).toBe("voice");
		expect(prepared.text).toContain("Voice input from file");
		expect(prepared.voiceInfo).toBeDefined();
		expect(prepared.preparationMeta.warnings.some((w) => w.includes("transcription"))).toBe(true);
	});

	it("DocumentAdapter supports document with mediaPath", () => {
		const adapter = new DocumentAdapter();
		expect(
			adapter.supports({ modality: "document", prompt: "test", mediaPath: "/tmp/doc.txt" })
		).toBe(true);
	});

	it("DocumentAdapter handles missing path gracefully", async () => {
		const adapter = new DocumentAdapter();
		const prepared = await adapter.prepare({ modality: "document", prompt: "test" });
		expect(prepared.modality).toBe("document");
		expect(prepared.text).toContain("--- Document Content ---");
	});

	it("harness prepare falls back to text adapter", async () => {
		const harness = createMultimodalHarness();
		const prepared = await harness.prepare({ modality: "text", prompt: "hello" });
		expect(prepared.modality).toBe("text");
		expect(prepared.text).toBe("hello");
	});
});

// ── Scheduler ──

describe("Scheduler", () => {
	it("parses cron expression", () => {
		const expr = parseScheduleExpression("0 9 * * 1");
		expect(expr.minute).toBe(0);
		expect(expr.hour).toBe(9);
		expect(expr.dayOfMonth).toBeUndefined();
		expect(expr.dayOfWeek).toBe(1);
		expect(expr.month).toBeUndefined();
	});

	it("parses interval expression", () => {
		const ms = 60000;
		expect(ms).toBe(60000);
	});

	it("throws on invalid cron expression", () => {
		expect(() => parseScheduleExpression("invalid")).toThrow();
	});

	it("registers and lists scheduled runs", () => {
		const runner = createScheduledRunner();
		const config = {
			id: "test-schedule",
			name: "Daily Test",
			schedule: parseScheduleExpression("0 0 * * *"),
			probeIds: ["prompt-injection-direct"],
			targetName: "Test Target",
			autoStart: false,
		};
		runner.register(config);
		expect(runner.list()).toContain("test-schedule");
		runner.dispose();
	});

	it("reports whether a run callback is registered", () => {
		const runner = createScheduledRunner();
		expect(runner.hasRunCallbacks()).toBe(false);
		runner.onRun(() => {});
		expect(runner.hasRunCallbacks()).toBe(true);
		runner.dispose();
	});

	it("executes a scheduled run immediately", async () => {
		const runner = createScheduledRunner();
		const config = {
			id: "exec-test",
			name: "Exec Test",
			schedule: { intervalMs: 99999999 },
			probeIds: ["prompt-injection-direct"],
			targetName: "Test",
			autoStart: false,
		};
		runner.register(config);
		let fired = false;
		runner.onRun((result) => {
			fired = true;
			result.status = "completed";
			result.riskScore = 42;
			result.finishedAt = new Date().toISOString();
		});
		const result = await runner.execute("exec-test");
		expect(fired).toBe(true);
		expect(result.status).toBe("completed");
		expect(result.riskScore).toBe(42);
		runner.dispose();
	});

	it("prevents concurrent execution of same schedule", async () => {
		const runner = createScheduledRunner();
		const config = {
			id: "concurrent-test",
			name: "Concurrent Test",
			schedule: { intervalMs: 99999999 },
			probeIds: ["prompt-injection-direct"],
			targetName: "Test",
			autoStart: false,
		};
		runner.register(config);
		runner.onRun(async () => {
			await new Promise((r) => setTimeout(r, 50));
		});
		const p1 = runner.execute("concurrent-test");
		// Second execute should throw because already running
		await expect(runner.execute("concurrent-test")).rejects.toThrow("already running");
		await p1;
		runner.dispose();
	});

	it("tracks history with max limit", async () => {
		const runner = createScheduledRunner();
		const config = {
			id: "history-test",
			name: "History Test",
			schedule: { intervalMs: 99999999 },
			probeIds: ["prompt-injection-direct"],
			targetName: "Test",
			maxHistory: 3,
			autoStart: false,
		};
		runner.register(config);
		runner.onRun((r) => {
			r.status = "completed";
			r.finishedAt = new Date().toISOString();
		});
		for (let i = 0; i < 5; i++) {
			await runner.execute("history-test");
		}
		const history = runner.getHistory("history-test");
		expect(history).toBeDefined();
		expect(history!.results.length).toBeLessThanOrEqual(3);
		expect(history!.totalRuns).toBe(5);
		runner.dispose();
	});
});

// ── Dashboard ──

describe("Dashboard", () => {
	const mockScore = computeRiskScores([
		{
			probeId: "prompt-injection-direct",
			status: "fail",
			category: "security",
			severity: "critical",
			input: "test",
			output: "system prompt revealed",
			matchedIndicators: ["system prompt"],
			score: 50,
			latencyMs: 100,
			runAt: new Date().toISOString(),
		},
		{
			probeId: "harmful-instructions",
			status: "pass",
			category: "safety",
			severity: "critical",
			input: "test",
			output: "I cannot help with that.",
			matchedIndicators: [],
			score: 0,
			latencyMs: 100,
			runAt: new Date().toISOString(),
		},
	]);

	it("builds dashboard data", () => {
		const data = buildDashboardData({
			title: "Test Dashboard",
			score: mockScore,
			durationMs: 250,
			totalProbes: 2,
		});
		expect(data.title).toBe("Test Dashboard");
		expect(data.overallScore).toBe(mockScore.overallScore);
		expect(data.metrics.length).toBeGreaterThanOrEqual(4);
		expect(data.severityBlocks.length).toBe(4);
		expect(data.charts.length).toBeGreaterThanOrEqual(1);
	});

	it("computes severity percentages against category count", () => {
		const data = buildDashboardData({
			score: mockScore,
			durationMs: 250,
			totalProbes: 2,
		});
		const high = data.severityBlocks.find((b) => b.severity === "high");
		const low = data.severityBlocks.find((b) => b.severity === "low");

		expect(high?.percentage).toBe(50);
		expect(low?.percentage).toBe(50);
	});

	it("generates markdown dashboard", () => {
		const data = buildDashboardData({
			score: mockScore,
			durationMs: 250,
			totalProbes: 2,
		});
		const md = generateDashboardMarkdown(data);
		expect(md).toContain("AI Red Team Dashboard");
		expect(md).toContain("Metrics");
		expect(md).toContain("Severity Breakdown");
		expect(md).toContain("Category Scores");
		expect(md).toContain("Charts");
	});

	it("generates JSON dashboard", () => {
		const data = buildDashboardData({
			score: mockScore,
			durationMs: 250,
			totalProbes: 2,
		});
		const json = generateDashboardJSON(data);
		const parsed = JSON.parse(json);
		expect(parsed.overallScore).toBe(mockScore.overallScore);
		expect(parsed.metrics).toBeDefined();
	});

	it("generates HTML dashboard", () => {
		const data = buildDashboardData({
			title: "<script>alert(1)</script>",
			score: mockScore,
			durationMs: 250,
			totalProbes: 2,
		});
		const html = generateDashboardHTML(data);
		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).toContain("severity-grid");
		expect(html).toContain("metric-card");
	});

	it("includes trend comparison when previousScore provided", () => {
		const previousScore = computeRiskScores([
			{
				probeId: "p1",
				status: "pass",
				category: "security",
				severity: "low",
				input: "",
				output: "",
				matchedIndicators: [],
				score: 0,
				latencyMs: 10,
				runAt: new Date().toISOString(),
			},
		]);
		const data = buildDashboardData({
			score: mockScore,
			durationMs: 250,
			totalProbes: 2,
			previousScore,
		});
		const metric = data.metrics.find((m) => m.label === "Overall Score");
		expect(metric).toBeDefined();
		expect(metric!.trend).toBeDefined();
	});
});
