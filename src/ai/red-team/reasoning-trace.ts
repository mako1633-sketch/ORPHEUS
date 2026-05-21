/**
 * AI Red Team Reasoning Traces
 *
 * Captures step-by-step reasoning for each probe execution,
 * risk-score computation, and batch-run decisions.
 * Provides explainability and auditability for red-team results.
 */

import type { AIProbe, ProbeResult, ProbeCategory } from "./probe-library";
import type { CategoryRiskScore, OverallRiskScore } from "./risk-scorer";
import type { BatchRunSummary } from "./batch-runner";

export interface ProbeReasoningTrace {
	probeId: string;
	timestamp: string;
	steps: ReasoningStep[];
	finalScore: number;
	status: ProbeResult["status"];
	confidence: number; // 0-1, self-check confidence
}

export interface ReasoningStep {
	order: number;
	action: string;
	observation: string;
	inference: string;
}

export interface CategoryReasoningTrace {
	category: ProbeCategory;
	timestamp: string;
	steps: ReasoningStep[];
	passed: number;
	failed: number;
	errors: number;
	avgScore: number;
	weightedScore: number;
	severity: CategoryRiskScore["severity"];
	confidence: number;
}

export interface OverallReasoningTrace {
	timestamp: string;
	steps: ReasoningStep[];
	overallScore: number;
	overallSeverity: OverallRiskScore["overallSeverity"];
	criticalFailurePenalty: number;
	confidence: number;
}

export interface BatchReasoningTrace {
	runId: string;
	batchSummary: Pick<BatchRunSummary, "startedAt" | "finishedAt" | "durationMs" | "cancelled">;
	probeTraces: ProbeReasoningTrace[];
	categoryTraces: CategoryReasoningTrace[];
	overallTrace: OverallReasoningTrace;
	completionGate: {
		validated: boolean;
		expectedProbes: number;
		actualProbes: number;
		missingProbeIds: string[];
	};
	notes: string[];
}

// In-memory trace store (can be persisted by caller if needed)
const traceStore = new Map<string, BatchReasoningTrace>();

/**
 * Create a step logger for a probe run.
 */
export function createProbeTracer(probe: AIProbe): {
	addStep: (action: string, observation: string, inference: string) => void;
	build: (finalResult: ProbeResult, confidence: number) => ProbeReasoningTrace;
} {
	const steps: ReasoningStep[] = [];
	let order = 0;

	return {
		addStep(action: string, observation: string, inference: string) {
			steps.push({ order: ++order, action, observation, inference });
		},
		build(finalResult: ProbeResult, confidence: number): ProbeReasoningTrace {
			return {
				probeId: probe.id,
				timestamp: new Date().toISOString(),
				steps: [...steps],
				finalScore: finalResult.score,
				status: finalResult.status,
				confidence,
			};
		},
	};
}

/**
 * Generate a reasoning trace for category-level risk computation.
 */
export function traceCategoryReasoning(
	category: ProbeCategory,
	catResults: ProbeResult[],
	weightedScore: number,
	severity: CategoryRiskScore["severity"]
): CategoryReasoningTrace {
	const passed = catResults.filter((r) => r.status === "pass").length;
	const failed = catResults.filter((r) => r.status === "fail").length;
	const errors = catResults.filter((r) => r.status === "error").length;
	const avgScore =
		catResults.length > 0 ? catResults.reduce((a, b) => a + b.score, 0) / catResults.length : 0;

	const steps: ReasoningStep[] = [
		{
			order: 1,
			action: "Categorize results by category",
			observation: `Found ${catResults.length} results for ${category}`,
			inference: "Category is present in the dataset",
		},
		{
			order: 2,
			action: "Count outcomes",
			observation: `${passed} passed, ${failed} failed, ${errors} errors`,
			inference: `${failed > 0 ? "Vulnerabilities detected" : "No failures in this category"}`,
		},
		{
			order: 3,
			action: "Compute weighted score",
			observation: `Weighted score = ${weightedScore.toFixed(1)}`,
			inference: `Severity classification: ${severity.toUpperCase()}`,
		},
	];

	const confidence =
		catResults.reduce((sum, r) => sum + (r.score > 0 ? 0.6 : 0.9), 0) /
		Math.max(catResults.length, 1);

	return {
		category,
		timestamp: new Date().toISOString(),
		steps,
		passed,
		failed,
		errors,
		avgScore: Math.round(avgScore * 10) / 10,
		weightedScore: Math.round(weightedScore * 10) / 10,
		severity,
		confidence: Math.round(confidence * 100) / 100,
	};
}

/**
 * Generate a reasoning trace for overall risk computation.
 */
export function traceOverallReasoning(
	overallScore: number,
	severity: OverallRiskScore["overallSeverity"],
	criticalFailures: number,
	categoryCount: number,
	rawOverall: number
): OverallReasoningTrace {
	const steps: ReasoningStep[] = [
		{
			order: 1,
			action: "Aggregate category weighted scores",
			observation: `Averaged across ${categoryCount} categories, raw score ${rawOverall.toFixed(1)}`,
			inference: "Baseline risk determined from category averages",
		},
		{
			order: 2,
			action: "Apply critical-failure penalty",
			observation: `${criticalFailures} critical failures found`,
			inference: `Penalty = +${criticalFailures * 5} points`,
		},
		{
			order: 3,
			action: "Clamp to valid range",
			observation: `Final score = ${overallScore.toFixed(1)} / 100`,
			inference: `Overall severity: ${severity.toUpperCase()}`,
		},
	];

	return {
		timestamp: new Date().toISOString(),
		steps,
		overallScore,
		overallSeverity: severity,
		criticalFailurePenalty: criticalFailures * 5,
		confidence: criticalFailures > 0 ? 0.75 : 0.92,
	};
}

/**
 * Store a completed batch reasoning trace.
 */
export function storeTrace(runId: string, trace: BatchReasoningTrace): void {
	traceStore.set(runId, trace);
}

/**
 * Retrieve a stored batch reasoning trace.
 */
export function getTrace(runId: string): BatchReasoningTrace | undefined {
	return traceStore.get(runId);
}

/**
 * List all stored trace IDs.
 */
export function listTraceIds(): string[] {
	return Array.from(traceStore.keys());
}

/**
 * Purge old traces (by age in ms).
 */
export function purgeTracesOlderThan(maxAgeMs: number): number {
	const now = Date.now();
	let removed = 0;
	for (const [id, trace] of traceStore) {
		if (
			new Date(trace.batchSummary.finishedAt ?? trace.batchSummary.startedAt).getTime() <
			now - maxAgeMs
		) {
			traceStore.delete(id);
			removed++;
		}
	}
	return removed;
}

/**
 * Serialize a trace to JSON for export / audit.
 */
export function serializeTrace(trace: BatchReasoningTrace): string {
	return JSON.stringify(trace, null, 2);
}

/**
 * Count stored traces.
 */
export function traceCount(): number {
	return traceStore.size;
}
