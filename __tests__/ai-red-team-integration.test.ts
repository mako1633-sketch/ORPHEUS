import { describe, expect, it } from "bun:test";
import { runBatch } from "../src/ai/red-team/batch-runner";
import { getProbesByCategory } from "../src/ai/red-team/probe-library";
import { listTraceIds, getTrace } from "../src/ai/red-team/reasoning-trace";
import { persistedRunCount, getRunsForTarget } from "../src/ai/red-team/result-persistence";

// ── Batch Runner Enhancement Integration ──

describe("runBatch Enhancement Flags", () => {
	const probes = getProbesByCategory("trustworthiness").slice(0, 3);
	const sendPrompt = async (prompt: string) => {
		if (prompt.includes("penguins")) {
			return "not all birds can fly, penguins cannot fly, the conclusion is incorrect";
		}
		return "I don't know anything about that.";
	};

	it("runBatch with enableSelfCheck populates result selfCheck fields", async () => {
		const summary = await runBatch(
			{
				probes,
				concurrency: 1,
				requestDelayMs: 0,
				probeTimeoutMs: 5000,
				batchTimeoutMs: 30000,
				maxRetries: 0,
				retryDelayMs: 0,
				enableSelfCheck: true,
			},
			sendPrompt
		);

		expect(summary.selfCheck).toBeDefined();
		expect(summary.selfCheck!.overallConfidence).toBeGreaterThanOrEqual(0);
		expect(summary.selfCheck!.flagged).toBeDefined();

		// Each result should have selfCheck attached
		for (const r of summary.results) {
			expect(r.selfCheck).toBeDefined();
			expect(r.selfCheck!.valid).toBeTypeOf("boolean");
			expect(r.selfCheck!.confidence).toBeGreaterThanOrEqual(0);
			expect(r.selfCheck!.confidence).toBeLessThanOrEqual(1);
		}
	});

	it("runBatch with enableCompletionGates populates gateResult", async () => {
		const summary = await runBatch(
			{
				probes,
				concurrency: 1,
				requestDelayMs: 0,
				probeTimeoutMs: 5000,
				batchTimeoutMs: 30000,
				maxRetries: 0,
				retryDelayMs: 0,
				enableCompletionGates: true,
			},
			sendPrompt
		);

		expect(summary.gateResult).toBeDefined();
		expect(summary.gateResult!.valid).toBe(true);
		expect(summary.gateResult!.missingProbeIds.length).toBe(0);
	});

	it("runBatch with enableTraces populates overallTraceId and stores trace", async () => {
		const beforeCount = listTraceIds().length;
		const summary = await runBatch(
			{
				probes,
				concurrency: 1,
				requestDelayMs: 0,
				probeTimeoutMs: 5000,
				batchTimeoutMs: 30000,
				maxRetries: 0,
				retryDelayMs: 0,
				enableTraces: true,
			},
			sendPrompt
		);

		expect(summary.overallTraceId).toBeDefined();
		const trace = getTrace(summary.overallTraceId!);
		expect(trace).toBeDefined();
		expect(trace!.overallTrace).toBeDefined();
		expect(trace!.categoryTraces.length).toBeGreaterThanOrEqual(1);
		expect(listTraceIds().length).toBe(beforeCount + 1);
	});

	it("runBatch with enableAutoPersist persists run when targetName is set", async () => {
		const targetName = `integration-test-${Date.now()}`;
		const beforeCount = persistedRunCount();

		await runBatch(
			{
				probes,
				concurrency: 1,
				requestDelayMs: 0,
				probeTimeoutMs: 5000,
				batchTimeoutMs: 30000,
				maxRetries: 0,
				retryDelayMs: 0,
				enableAutoPersist: true,
				targetName,
			},
			sendPrompt
		);

		expect(persistedRunCount()).toBeGreaterThanOrEqual(beforeCount + 1);
		const runs = getRunsForTarget(targetName);
		expect(runs.length).toBeGreaterThanOrEqual(1);
		expect(runs[0].targetName).toBe(targetName);
	});

	it("runBatch with all flags enabled works end-to-end", async () => {
		const targetName = `full-integration-${Date.now()}`;
		const summary = await runBatch(
			{
				probes,
				concurrency: 1,
				requestDelayMs: 0,
				probeTimeoutMs: 5000,
				batchTimeoutMs: 30000,
				maxRetries: 0,
				retryDelayMs: 0,
				enableSelfCheck: true,
				enableCompletionGates: true,
				enableTraces: true,
				enableAutoPersist: true,
				targetName,
			},
			sendPrompt
		);

		expect(summary.results.length).toBe(probes.length);
		expect(summary.selfCheck).toBeDefined();
		expect(summary.gateResult).toBeDefined();
		expect(summary.overallTraceId).toBeDefined();

		for (const r of summary.results) {
			expect(r.selfCheck).toBeDefined();
		}
	});
});
