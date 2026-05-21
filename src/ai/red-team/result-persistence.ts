/**
 * AI Red Team Result Persistence
 *
 * Save/load historical batch-run results for trend comparison
 * and regression detection across sessions.
 */

import type { BatchRunSummary } from "./batch-runner";
import type { OverallRiskScore } from "./risk-scorer";
import type { ProbeResult } from "./probe-library";

export interface PersistedRun {
	runId: string;
	targetName: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	overallScore: number;
	overallSeverity: string;
	passedCount: number;
	failedCount: number;
	errorCount: number;
	totalProbes: number;
	cancelled: boolean;
	results: ProbeResult[];
	riskScore: OverallRiskScore;
	notes?: string[];
}

export interface TrendComparison {
	current: PersistedRun;
	previous?: PersistedRun;
	scoreChange: number;
	passedChange: number;
	failedChange: number;
	errorChange: number;
	trend: "improving" | "worsening" | "stable";
	newFailures: string[];
	fixedFailures: string[];
	persistingFailures: string[];
}

// In-memory persistence store (mirrors can be written to disk by caller)
const runStore = new Map<string, PersistedRun>();

function generateRunId(): string {
	return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Persist a completed batch run.
 */
export function persistRun(
	summary: BatchRunSummary,
	riskScore: OverallRiskScore,
	targetName: string,
	notes?: string[]
): PersistedRun {
	const runId = generateRunId();
	const persisted: PersistedRun = {
		runId,
		targetName,
		startedAt: summary.startedAt,
		finishedAt: summary.finishedAt,
		durationMs: summary.durationMs,
		overallScore: riskScore.overallScore,
		overallSeverity: riskScore.overallSeverity,
		passedCount: riskScore.passedProbes.length,
		failedCount: riskScore.failedProbes.length,
		errorCount: riskScore.errorProbes.length,
		totalProbes: summary.results.length,
		cancelled: summary.cancelled,
		results: summary.results,
		riskScore,
		notes,
	};
	runStore.set(runId, persisted);
	return persisted;
}

/**
 * Load a persisted run by ID.
 */
export function loadRun(runId: string): PersistedRun | undefined {
	return runStore.get(runId);
}

/**
 * List all persisted run IDs (sorted by date descending).
 */
export function listRunIds(): string[] {
	return Array.from(runStore.values())
		.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
		.map((r) => r.runId);
}

/**
 * Get all persisted runs for a target (newest first).
 */
export function getRunsForTarget(targetName: string): PersistedRun[] {
	return Array.from(runStore.values())
		.filter((r) => r.targetName === targetName)
		.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

/**
 * Compare the current run against the previous run for the same target.
 */
export function compareTrends(current: PersistedRun, previous?: PersistedRun): TrendComparison {
	const prev = previous ?? current;

	const scoreChange = current.overallScore - prev.overallScore;
	const passedChange = current.passedCount - prev.passedCount;
	const failedChange = current.failedCount - prev.failedCount;
	const errorChange = current.errorCount - prev.errorCount;

	const currentFailed = new Set(current.riskScore.failedProbes);
	const prevFailed = new Set(prev.riskScore.failedProbes);

	const newFailures = current.riskScore.failedProbes.filter((id) => !prevFailed.has(id));
	const fixedFailures = prev.riskScore.failedProbes.filter((id) => !currentFailed.has(id));
	const persistingFailures = current.riskScore.failedProbes.filter((id) => prevFailed.has(id));

	let trend: TrendComparison["trend"] = "stable";
	if (scoreChange < -5 || failedChange < -1) trend = "improving";
	else if (scoreChange > 5 || failedChange > 1) trend = "worsening";
	else if (newFailures.length > 0) trend = "worsening";
	else if (fixedFailures.length > 0) trend = "improving";

	return {
		current,
		previous: previous ?? undefined,
		scoreChange: Math.round(scoreChange * 10) / 10,
		passedChange,
		failedChange,
		errorChange,
		trend,
		newFailures,
		fixedFailures,
		persistingFailures,
	};
}

/**
 * Auto-compare current run against most recent run for same target.
 */
export function autoCompare(current: PersistedRun): TrendComparison {
	const previous = getRunsForTarget(current.targetName).find((r) => r.runId !== current.runId);
	return compareTrends(current, previous);
}

/**
 * Purge old runs beyond a maximum count per target.
 */
export function purgeOldRuns(maxRunsPerTarget: number): number {
	const byTarget = new Map<string, PersistedRun[]>();
	for (const run of runStore.values()) {
		const list = byTarget.get(run.targetName) ?? [];
		list.push(run);
		byTarget.set(run.targetName, list);
	}

	let removed = 0;
	for (const [_target, runs] of byTarget) {
		if (runs.length > maxRunsPerTarget) {
			const toDelete = runs
				.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
				.slice(maxRunsPerTarget);
			for (const run of toDelete) {
				runStore.delete(run.runId);
				removed++;
			}
		}
	}
	return removed;
}

/**
 * Serialize all persisted runs to a JSON string for export.
 */
export function serializeAllRuns(): string {
	return JSON.stringify(
		Array.from(runStore.values()).sort(
			(a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
		),
		null,
		2
	);
}

/**
 * Deserialize runs from a JSON string and restore them.
 */
export function deserializeRuns(json: string): { restored: number; errors: string[] } {
	const errors: string[] = [];
	try {
		const parsed = JSON.parse(json) as PersistedRun[];
		if (!Array.isArray(parsed)) {
			errors.push("Expected array of runs");
			return { restored: 0, errors };
		}
		for (const run of parsed) {
			if (run.runId && run.startedAt) {
				runStore.set(run.runId, run);
			} else {
				errors.push(`Invalid run entry: missing runId or startedAt`);
			}
		}
		return { restored: parsed.length, errors };
	} catch (e) {
		errors.push(`Parse error: ${e instanceof Error ? e.message : String(e)}`);
		return { restored: 0, errors };
	}
}

/**
 * Count total persisted runs.
 */
export function persistedRunCount(): number {
	return runStore.size;
}
