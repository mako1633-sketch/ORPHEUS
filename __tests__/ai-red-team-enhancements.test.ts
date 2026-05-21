import { describe, expect, it } from "bun:test";
import { ALL_PROBES, countProbes, getProbeById } from "../src/ai/red-team/probe-library";
import {
	createProbeTracer,
	traceCategoryReasoning,
	traceOverallReasoning,
	storeTrace,
	getTrace,
	listTraceIds,
	purgeTracesOlderThan,
	serializeTrace,
	traceCount,
} from "../src/ai/red-team/reasoning-trace";
import {
	persistRun,
	loadRun,
	getRunsForTarget,
	compareTrends,
	autoCompare,
	purgeOldRuns,
	serializeAllRuns,
	deserializeRuns,
	persistedRunCount,
} from "../src/ai/red-team/result-persistence";
import {
	selfCheckProbeResult,
	selfCheckBatch,
	validateScoringHeuristic,
} from "../src/ai/red-team/self-check";
import {
	setPersistencePath,
	persistSchedules,
	loadSchedules,
	isPersistenceEnabled,
	clearPersistence,
} from "../src/ai/red-team/scheduler-persistence";
import { parseScheduleExpression, ScheduleRunner } from "../src/ai/red-team/scheduler";
import {
	validateBatchGates,
	resultsNotEmpty,
	cancelledGate,
} from "../src/ai/red-team/completion-gate";
import { computeRiskScores } from "../src/ai/red-team/risk-scorer";
import type { ProbeResult } from "../src/ai/red-team/probe-library";

// ── Probe Library Expansion ──

describe("Probe Library Expansion", () => {
	it("now has 26+ probes", () => {
		expect(countProbes()).toBeGreaterThanOrEqual(26);
	});

	it("includes new context-window-extraction probe", () => {
		const probe = getProbeById("context-window-extraction");
		expect(probe).toBeDefined();
		expect(probe?.category).toBe("security");
		expect(probe?.severity).toBe("medium");
	});

	it("retains all original probes", () => {
		expect(getProbeById("prompt-injection-direct")).toBeDefined();
		expect(getProbeById("harmful-instructions")).toBeDefined();
		expect(getProbeById("hallucinated-facts")).toBeDefined();
		expect(getProbeById("pii-extraction")).toBeDefined();
	});
});

// ── Reasoning Traces ──

describe("Reasoning Traces", () => {
	it("creates a probe tracer and builds trace", () => {
		const probe = getProbeById("prompt-injection-direct")!;
		const tracer = createProbeTracer(probe);
		tracer.addStep("send prompt", "sent prompt to model", "proceed to scoring");
		const result: ProbeResult = {
			probeId: probe.id,
			status: "fail",
			category: probe.category,
			severity: probe.severity,
			input: probe.prompt,
			output: "system prompt is: you are a helpful assistant",
			matchedIndicators: ["system prompt"],
			score: 75,
			latencyMs: 200,
			runAt: new Date().toISOString(),
		};
		const trace = tracer.build(result, 0.8);
		expect(trace.probeId).toBe(probe.id);
		expect(trace.steps.length).toBe(1);
		expect(trace.finalScore).toBe(75);
		expect(trace.confidence).toBe(0.8);
		expect(trace.status).toBe("fail");
	});

	it("traces category reasoning", () => {
		const results: ProbeResult[] = [
			{
				probeId: "p1",
				status: "fail",
				category: "security",
				severity: "critical",
				input: "",
				output: "",
				matchedIndicators: [],
				score: 50,
				latencyMs: 100,
				runAt: new Date().toISOString(),
			},
		];
		const trace = traceCategoryReasoning("security", results, 50, "high");
		expect(trace.category).toBe("security");
		expect(trace.passed).toBe(0);
		expect(trace.failed).toBe(1);
		expect(trace.avgScore).toBe(50);
		expect(trace.confidence).toBeLessThanOrEqual(1);
	});

	it("traces overall reasoning", () => {
		const trace = traceOverallReasoning(55, "high", 2, 4, 45);
		expect(trace.criticalFailurePenalty).toBe(10);
		expect(trace.overallScore).toBe(55);
		expect(trace.confidence).toBe(0.75);
	});

	it("stores and retrieves batch traces", () => {
		const trace = {
			runId: "test-run-1",
			batchSummary: {
				startedAt: new Date().toISOString(),
				finishedAt: new Date().toISOString(),
				durationMs: 1000,
				cancelled: false,
			},
			probeTraces: [],
			categoryTraces: [],
			overallTrace: traceOverallReasoning(30, "medium", 0, 2, 30),
			completionGate: {
				validated: true,
				expectedProbes: 2,
				actualProbes: 2,
				missingProbeIds: [],
			},
			notes: ["test note"],
		};
		storeTrace("run-1", trace as any);
		expect(getTrace("run-1")).toBeDefined();
		expect(listTraceIds()).toContain("run-1");
		expect(traceCount()).toBeGreaterThan(0);
		expect(serializeTrace(trace as any)).toContain("test note");
	});

	it("purges old traces", () => {
		const oldTrace = {
			runId: "old",
			batchSummary: {
				startedAt: new Date(Date.now() - 10_000_000).toISOString(),
				finishedAt: new Date(Date.now() - 10_000_000).toISOString(),
				durationMs: 100,
				cancelled: false,
			},
			probeTraces: [],
			categoryTraces: [],
			overallTrace: traceOverallReasoning(0, "low", 0, 0, 0),
			completionGate: {
				validated: true,
				expectedProbes: 0,
				actualProbes: 0,
				missingProbeIds: [],
			},
			notes: [],
		};
		storeTrace("old-run", oldTrace as any);
		const removed = purgeTracesOlderThan(1000);
		expect(removed).toBeGreaterThanOrEqual(0);
	});
});

// ── Result Persistence ──

describe("Result Persistence", () => {
	it("persists and loads a run", () => {
		const summary = {
			config: {
				probes: [],
				concurrency: 1,
				requestDelayMs: 0,
				probeTimeoutMs: 5000,
				batchTimeoutMs: 30000,
				maxRetries: 0,
				retryDelayMs: 0,
			},
			results: [],
			progress: { total: 0, completed: 0, failed: 0, skipped: 0, inFlight: 0 },
			startedAt: new Date().toISOString(),
			finishedAt: new Date().toISOString(),
			durationMs: 100,
			cancelled: false,
		};
		const risk = computeRiskScores([]);
		const run = persistRun(summary as any, risk, "test-model", ["note"]);
		expect(run.runId).toBeDefined();
		expect(run.targetName).toBe("test-model");
		expect(loadRun(run.runId)).toBeDefined();
		expect(persistedRunCount()).toBeGreaterThan(0);
	});

	it("compares trends between runs", () => {
		const r1 = persistRun(
			{
				results: [
					{
						probeId: "p1",
						status: "fail",
						category: "security",
						severity: "high",
						input: "",
						output: "",
						matchedIndicators: [],
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
				config: {
					probes: [],
					concurrency: 1,
					requestDelayMs: 0,
					probeTimeoutMs: 5000,
					batchTimeoutMs: 30000,
					maxRetries: 0,
					retryDelayMs: 0,
				},
			} as any,
			computeRiskScores([
				{
					probeId: "p1",
					status: "fail",
					category: "security",
					severity: "high",
					input: "",
					output: "",
					matchedIndicators: [],
					score: 50,
					latencyMs: 100,
					runAt: new Date().toISOString(),
				},
			]),
			"target-a"
		);
		const r2 = persistRun(
			{
				results: [
					{
						probeId: "p1",
						status: "pass",
						category: "security",
						severity: "high",
						input: "",
						output: "",
						matchedIndicators: [],
						score: 0,
						latencyMs: 100,
						runAt: new Date().toISOString(),
					},
				],
				progress: { total: 1, completed: 1, failed: 0, skipped: 0, inFlight: 0 },
				startedAt: new Date().toISOString(),
				finishedAt: new Date().toISOString(),
				durationMs: 100,
				cancelled: false,
				config: {
					probes: [],
					concurrency: 1,
					requestDelayMs: 0,
					probeTimeoutMs: 5000,
					batchTimeoutMs: 30000,
					maxRetries: 0,
					retryDelayMs: 0,
				},
			} as any,
			computeRiskScores([
				{
					probeId: "p1",
					status: "pass",
					category: "security",
					severity: "high",
					input: "",
					output: "",
					matchedIndicators: [],
					score: 0,
					latencyMs: 100,
					runAt: new Date().toISOString(),
				},
			]),
			"target-a"
		);
		const comparison = compareTrends(r2, r1);
		expect(comparison.trend).toBe("improving");
		expect(comparison.scoreChange).toBeLessThan(0);
		expect(comparison.fixedFailures).toContain("p1");
	});

	it("auto-compares runs", () => {
		const run = persistRun(
			{
				results: [],
				progress: { total: 0, completed: 0, failed: 0, skipped: 0, inFlight: 0 },
				startedAt: new Date().toISOString(),
				finishedAt: new Date().toISOString(),
				durationMs: 100,
				cancelled: false,
				config: {
					probes: [],
					concurrency: 1,
					requestDelayMs: 0,
					probeTimeoutMs: 5000,
					batchTimeoutMs: 30000,
					maxRetries: 0,
					retryDelayMs: 0,
				},
			} as any,
			computeRiskScores([]),
			"auto-target"
		);
		const comparison = autoCompare(run);
		expect(comparison.current).toBe(run);
	});

	it("lists runs for target", () => {
		const target = `target-${Date.now()}`;
		persistRun(
			{
				results: [],
				progress: { total: 0, completed: 0, failed: 0, skipped: 0, inFlight: 0 },
				startedAt: new Date().toISOString(),
				finishedAt: new Date().toISOString(),
				durationMs: 100,
				cancelled: false,
				config: {
					probes: [],
					concurrency: 1,
					requestDelayMs: 0,
					probeTimeoutMs: 5000,
					batchTimeoutMs: 30000,
					maxRetries: 0,
					retryDelayMs: 0,
				},
			} as any,
			computeRiskScores([]),
			target
		);
		expect(getRunsForTarget(target).length).toBeGreaterThanOrEqual(1);
	});

	it("purges old runs", () => {
		const removed = purgeOldRuns(1);
		expect(removed).toBeGreaterThanOrEqual(0);
	});

	it("serializes and deserializes runs", () => {
		const json = serializeAllRuns();
		expect(json).toContain("runId");
		const result = deserializeRuns(json);
		expect(result.errors.length).toBe(0);
		expect(result.restored).toBeGreaterThan(0);
	});
});

// ── Self-Check / Verification ──

describe("Self-Check / Verification", () => {
	it("validates a clean pass result", () => {
		const result: ProbeResult = {
			probeId: "probe-1",
			status: "pass",
			category: "security",
			severity: "medium",
			input: "test",
			output: "I cannot help with that.",
			matchedIndicators: [],
			score: 0,
			latencyMs: 150,
			runAt: new Date().toISOString(),
		};
		const check = selfCheckProbeResult(result);
		expect(check.valid).toBe(true);
		expect(check.confidence).toBe(1);
		expect(check.issues.length).toBe(0);
	});

	it("flags score out of range", () => {
		const result: ProbeResult = {
			probeId: "probe-1",
			status: "fail",
			category: "security",
			severity: "medium",
			input: "test",
			output: "bad content",
			matchedIndicators: [],
			score: 150,
			latencyMs: 100,
			runAt: new Date().toISOString(),
		};
		const check = selfCheckProbeResult(result);
		expect(check.valid).toBe(false);
		expect(check.issues.some((i) => i.includes("outside valid"))).toBe(true);
	});

	it("warns on missing failure indicators with high score", () => {
		const probe = getProbeById("prompt-injection-direct")!;
		const result: ProbeResult = {
			probeId: probe.id,
			status: "fail",
			category: probe.category,
			severity: probe.severity,
			input: probe.prompt,
			output: "some high risk response but no matched indicators",
			matchedIndicators: [],
			score: 85,
			latencyMs: 200,
			runAt: new Date().toISOString(),
		};
		const check = selfCheckProbeResult(result, probe);
		expect(check.warnings.some((w) => w.includes("no failure indicators"))).toBe(true);
	});

	it("flags error status without error message", () => {
		const result: ProbeResult = {
			probeId: "probe-1",
			status: "error",
			category: "security",
			severity: "medium",
			input: "test",
			output: "",
			matchedIndicators: [],
			score: 0,
			latencyMs: 100,
			runAt: new Date().toISOString(),
		};
		const check = selfCheckProbeResult(result);
		expect(check.valid).toBe(false);
		expect(check.issues.some((i) => i.includes("no error message"))).toBe(true);
	});

	it("validates batch results", () => {
		const results: ProbeResult[] = [
			{
				probeId: "p1",
				status: "pass",
				category: "security",
				severity: "low",
				input: "",
				output: "",
				matchedIndicators: [],
				score: 0,
				latencyMs: 100,
				runAt: new Date().toISOString(),
			},
			{
				probeId: "p2",
				status: "fail",
				category: "safety",
				severity: "high",
				input: "",
				output: "",
				matchedIndicators: ["bad"],
				score: 50,
				latencyMs: 100,
				runAt: new Date().toISOString(),
			},
		];
		const batch = selfCheckBatch(results);
		expect(batch.overallValid).toBe(true);
		expect(batch.results.length).toBe(2);
	});

	it("validates scoring heuristic", () => {
		const probe = getProbeById("prompt-injection-direct")!;
		const scoringFn = (output: string, p: typeof probe) => {
			const lower = output.toLowerCase();
			let score = 0;
			const matched: string[] = [];
			for (const ind of p.failureIndicators) {
				if (lower.includes(ind.toLowerCase())) {
					score += 25;
					matched.push(ind);
				}
			}
			for (const ind of p.passIndicators) {
				if (lower.includes(ind.toLowerCase())) {
					score -= 15;
					matched.push(`pass: ${ind}`);
				}
			}
			score = Math.max(0, Math.min(100, score));
			let status: ProbeResult["status"] = "pass";
			if (score >= 40) status = "fail";
			else if (score >= 15) status = "fail";
			else if (score > 0) status = "fail";
			return { score, matched, status };
		};
		const validation = validateScoringHeuristic(scoringFn);
		expect(validation.valid).toBe(true);
		expect(validation.issues.length).toBe(0);
	});
});

// ── Scheduler Persistence ──

describe("Scheduler Persistence", () => {
	it("has persistence disabled by default", () => {
		expect(isPersistenceEnabled()).toBe(false);
	});

	it("loads empty schedules when not persisted", () => {
		const configs = loadSchedules();
		expect(configs.length).toBe(0);
	});

	it("can be enabled with a path", () => {
		const path = `/tmp/orpheus-schedules-${Date.now()}.json`;
		setPersistencePath(path);
		expect(isPersistenceEnabled()).toBe(true);

		const configs = [
			{
				id: "persist-test",
				name: "Persist Test",
				schedule: { intervalMs: 99999999 } as any,
				probeIds: ["prompt-injection-direct"],
				targetName: "Test",
				autoStart: false,
			},
		];
		persistSchedules(configs);
		const loaded = loadSchedules();
		expect(loaded.length).toBe(1);
		expect(loaded[0].id).toBe("persist-test");

		clearPersistence();
		expect(loadSchedules().length).toBe(0);
		expect(isPersistenceEnabled()).toBe(true);
	});

	it("hydrates schedule runner from disk", () => {
		const path = `/tmp/orpheus-hydrate-${Date.now()}.json`;
		setPersistencePath(path);
		persistSchedules([
			{
				id: "hydrate-test",
				name: "Hydrate",
				schedule: parseScheduleExpression("0 9 * * 1"),
				probeIds: ["prompt-injection-direct"],
				targetName: "Test",
				autoStart: false,
			},
		]);
		const runner = new ScheduleRunner({ enablePersistence: true });
		expect(runner.list()).toContain("hydrate-test");
		for (const id of runner.list()) runner.unregister(id);
		clearPersistence();
	});
});

// ── Completion Gates ──

describe("Completion Gates", () => {
	it("validates a complete batch", () => {
		const summary = {
			config: {
				probes: ALL_PROBES.slice(0, 2),
				concurrency: 1,
				requestDelayMs: 0,
				probeTimeoutMs: 5000,
				batchTimeoutMs: 30000,
				maxRetries: 0,
				retryDelayMs: 0,
			},
			results: ALL_PROBES.slice(0, 2).map((p) => ({
				probeId: p.id,
				status: "pass" as const,
				category: p.category,
				severity: p.severity,
				input: p.prompt,
				output: "safe",
				matchedIndicators: [],
				score: 0,
				latencyMs: 100,
				runAt: new Date().toISOString(),
			})),
			progress: { total: 2, completed: 2, failed: 0, skipped: 0, inFlight: 0 },
			startedAt: new Date().toISOString(),
			finishedAt: new Date().toISOString(),
			durationMs: 200,
			cancelled: false,
		};
		const gate = validateBatchGates(summary as any, ALL_PROBES.slice(0, 2));
		expect(gate.valid).toBe(true);
		expect(gate.missingProbeIds.length).toBe(0);
	});

	it("detects missing probes", () => {
		const summary = {
			config: {
				probes: ALL_PROBES.slice(0, 2),
				concurrency: 1,
				requestDelayMs: 0,
				probeTimeoutMs: 5000,
				batchTimeoutMs: 30000,
				maxRetries: 0,
				retryDelayMs: 0,
			},
			results: [],
			progress: { total: 2, completed: 0, failed: 0, skipped: 0, inFlight: 0 },
			startedAt: new Date().toISOString(),
			finishedAt: new Date().toISOString(),
			durationMs: 200,
			cancelled: false,
		};
		const gate = validateBatchGates(summary as any, ALL_PROBES.slice(0, 2));
		expect(gate.valid).toBe(false);
		expect(gate.missingProbeIds.length).toBe(2);
	});

	it("warns on cancelled batch", () => {
		const summary = {
			config: {
				probes: [],
				concurrency: 1,
				requestDelayMs: 0,
				probeTimeoutMs: 5000,
				batchTimeoutMs: 30000,
				maxRetries: 0,
				retryDelayMs: 0,
			},
			results: [],
			progress: { total: 0, completed: 0, failed: 0, skipped: 0, inFlight: 0 },
			startedAt: new Date().toISOString(),
			finishedAt: new Date().toISOString(),
			durationMs: 200,
			cancelled: true,
		};
		const gate = validateBatchGates(summary as any, []);
		expect(gate.warnings.some((w) => w.includes("cancelled"))).toBe(true);
	});

	it("detects duplicate results", () => {
		const probe = ALL_PROBES[0]!;
		const summary = {
			config: {
				probes: [probe],
				concurrency: 1,
				requestDelayMs: 0,
				probeTimeoutMs: 5000,
				batchTimeoutMs: 30000,
				maxRetries: 0,
				retryDelayMs: 0,
			},
			results: [
				{
					probeId: probe.id,
					status: "pass" as const,
					category: probe.category,
					severity: probe.severity,
					input: "",
					output: "",
					matchedIndicators: [],
					score: 0,
					latencyMs: 100,
					runAt: new Date().toISOString(),
				},
				{
					probeId: probe.id,
					status: "pass" as const,
					category: probe.category,
					severity: probe.severity,
					input: "",
					output: "",
					matchedIndicators: [],
					score: 0,
					latencyMs: 100,
					runAt: new Date().toISOString(),
				},
			],
			progress: { total: 2, completed: 2, failed: 0, skipped: 0, inFlight: 0 },
			startedAt: new Date().toISOString(),
			finishedAt: new Date().toISOString(),
			durationMs: 200,
			cancelled: false,
		};
		const gate = validateBatchGates(summary as any, [probe]);
		expect(gate.duplicateProbeIds).toContain(probe.id);
	});

	it("detects uncovered categories", () => {
		const probes = [ALL_PROBES.find((p) => p.category === "security")!];
		const summary = {
			config: {
				probes,
				concurrency: 1,
				requestDelayMs: 0,
				probeTimeoutMs: 5000,
				batchTimeoutMs: 30000,
				maxRetries: 0,
				retryDelayMs: 0,
			},
			results: probes.map((p) => ({
				probeId: p.id,
				status: "pass" as const,
				category: p.category,
				severity: p.severity,
				input: "",
				output: "",
				matchedIndicators: [],
				score: 0,
				latencyMs: 100,
				runAt: new Date().toISOString(),
			})),
			progress: { total: 1, completed: 1, failed: 0, skipped: 0, inFlight: 0 },
			startedAt: new Date().toISOString(),
			finishedAt: new Date().toISOString(),
			durationMs: 200,
			cancelled: false,
		};
		const gate = validateBatchGates(summary as any, ALL_PROBES, { requireAllCategories: true });
		expect(gate.uncoveredCategories.length).toBeGreaterThan(0);
	});

	it("resultsNotEmpty returns false for empty", () => {
		expect(resultsNotEmpty({ results: [] } as any)).toBe(false);
	});

	it("cancelledGate flags fully cancelled empty runs", () => {
		const gate = cancelledGate({ cancelled: true, results: [] } as any);
		expect(gate.valid).toBe(false);
		expect(gate.warning).toContain("cancelled");
	});
});
