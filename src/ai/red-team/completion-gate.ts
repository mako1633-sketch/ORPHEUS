/**
 * AI Red Team Completion Gates
 *
 * Validates that all expected probes are present in batch results,
 * detects missing / untracked probes, and prevents partial result
 * consumption downstream.
 */

import type { AIProbe } from "./probe-library";
import type { BatchRunSummary } from "./batch-runner";

export interface CompletionGateResult {
	valid: boolean;
	expectedProbes: number;
	actualProbes: number;
	missingProbeIds: string[];
	unexpectedProbeIds: string[];
	duplicateProbeIds: string[];
	coveredCategories: string[];
	uncoveredCategories: string[];
	warnings: string[];
}

export interface CompletionGateConfig {
	/** Require that every expected probe ID is represented */
	requireAllProbes: boolean;
	/** Require coverage of all 4 categories */
	requireAllCategories: boolean;
	/** Warn if a probe ID appears more than once */
	warnOnDuplicates: boolean;
	/** Warn if unexpected probe IDs are present */
	warnOnUnexpected: boolean;
}

export const DEFAULT_GATE_CONFIG: CompletionGateConfig = {
	requireAllProbes: true,
	requireAllCategories: false,
	warnOnDuplicates: true,
	warnOnUnexpected: true,
};

/**
 * Validate a batch run summary against the expected probes.
 */
export function validateBatchGates(
	summary: BatchRunSummary,
	expectedProbes: AIProbe[],
	config: Partial<CompletionGateConfig> = {}
): CompletionGateResult {
	const cfg: CompletionGateConfig = { ...DEFAULT_GATE_CONFIG, ...config };
	const warnings: string[] = [];

	const expectedIds = new Set(expectedProbes.map((p) => p.id));
	const resultIds = summary.results.map((r) => r.probeId);
	const resultIdCounts = new Map<string, number>();
	for (const id of resultIds) {
		resultIdCounts.set(id, (resultIdCounts.get(id) ?? 0) + 1);
	}

	// Missing probes
	const actualProbeIds = new Set(resultIds);
	const missingProbeIds = expectedProbes.filter((p) => !actualProbeIds.has(p.id)).map((p) => p.id);

	// Unexpected probes
	const unexpectedProbeIds = resultIds.filter((id) => !expectedIds.has(id));

	// Duplicates
	const duplicateProbeIds = Array.from(resultIdCounts.entries())
		.filter(([, count]) => count > 1)
		.map(([id]) => id);

	// Category coverage
	const expectedCategories = new Set(expectedProbes.map((p) => p.category));
	const coveredCategories = new Set(summary.results.map((r) => r.category));
	const uncoveredCategories = Array.from(expectedCategories).filter(
		(c) => !coveredCategories.has(c)
	);

	if (cfg.requireAllProbes && missingProbeIds.length > 0) {
		warnings.push(
			`Missing ${missingProbeIds.length} probes (${missingProbeIds.slice(0, 3).join(", ")}${missingProbeIds.length > 3 ? "..." : ""})`
		);
	}

	if (cfg.requireAllCategories && uncoveredCategories.length > 0) {
		warnings.push(`Uncovered categories: ${uncoveredCategories.join(", ")}`);
	}

	if (cfg.warnOnDuplicates && duplicateProbeIds.length > 0) {
		warnings.push(
			`Duplicate probe results: ${duplicateProbeIds.slice(0, 3).join(", ")}${duplicateProbeIds.length > 3 ? "..." : ""}`
		);
	}

	if (cfg.warnOnUnexpected && unexpectedProbeIds.length > 0) {
		warnings.push(
			`Unexpected probe results: ${unexpectedProbeIds.slice(0, 3).join(", ")}${unexpectedProbeIds.length > 3 ? "..." : ""}`
		);
	}

	// Auto-warn on cancelled runs
	if (summary.cancelled) {
		warnings.push("Batch was cancelled — results may be incomplete");
	}

	// Auto-warn on errors
	const errorCount = summary.results.filter((r) => r.status === "error").length;
	if (errorCount > 0) {
		warnings.push(`${errorCount} probes errored — verify network/model availability`);
	}

	// Auto-warn if result count differs from expected (but only if not already flagged)
	if (summary.results.length !== expectedProbes.length && missingProbeIds.length === 0) {
		warnings.push(
			`Result count mismatch: expected ${expectedProbes.length}, got ${summary.results.length}`
		);
	}

	const valid =
		(!cfg.requireAllProbes || missingProbeIds.length === 0) &&
		(!cfg.requireAllCategories || uncoveredCategories.length === 0);

	return {
		valid,
		expectedProbes: expectedProbes.length,
		actualProbes: summary.results.length,
		missingProbeIds,
		unexpectedProbeIds,
		duplicateProbeIds,
		coveredCategories: Array.from(coveredCategories),
		uncoveredCategories,
		warnings,
	};
}

/**
 * Quick gate: fail if results are empty.
 */
export function resultsNotEmpty(summary: BatchRunSummary): boolean {
	return summary.results.length > 0;
}

/**
 * Quick gate: fail if batch was cancelled and results appear incomplete.
 */
export function cancelledGate(summary: BatchRunSummary): { valid: boolean; warning?: string } {
	if (!summary.cancelled) return { valid: true };
	const completed = summary.results.filter((r) => r.status !== "skipped").length;
	if (completed === 0) {
		return { valid: false, warning: "Batch was cancelled and no probes completed" };
	}
	return { valid: true, warning: "Batch was cancelled — results may be partial" };
}
