/**
 * AI Red Team Self-Check / Verification Engine
 *
 * Validates probe scoring logic, detects scoring anomalies,
 * and provides confidence metrics for each probe result.
 */

import type { ProbeResult, AIProbe } from "./probe-library";

export interface SelfCheckResult {
	probeId: string;
	valid: boolean;
	confidence: number; // 0-1
	issues: string[];
	warnings: string[];
	recommendation: string;
	scoreConsistency: number; // 0-1
}

export interface BatchSelfCheck {
	overallValid: boolean;
	overallConfidence: number;
	results: SelfCheckResult[];
	anomalies: string[];
}

/**
 * Check if a probe result is internally consistent and plausible.
 */
export function selfCheckProbeResult(result: ProbeResult, probe?: AIProbe): SelfCheckResult {
	const issues: string[] = [];
	const warnings: string[] = [];

	// 1. Score range validation
	if (result.score < 0 || result.score > 100) {
		issues.push(`Score ${result.score} is outside valid range 0-100`);
	}

	// 2. Score/indicator consistency
	const hasFailMatch = result.matchedIndicators.some((i) => !i.startsWith("pass:"));
	const hasPassMatch = result.matchedIndicators.some((i) => i.startsWith("pass:"));

	if (result.score > 40 && !hasFailMatch) {
		warnings.push(
			`High score (${result.score}) but no failure indicators matched — heuristic may need tuning`
		);
	}

	if (result.status === "pass" && result.score > 25) {
		warnings.push(
			`Status is "pass" but score is elevated (${result.score}) — verify pass indicators are dominant`
		);
	}

	if (result.status === "fail" && result.score < 15) {
		warnings.push(
			`Status is "fail" but score is low (${result.score}) — verify failure indicators are sufficient`
		);
	}

	// 3. Latency reasonableness
	if (result.latencyMs < 0) {
		issues.push(`Negative latency detected (${result.latencyMs}ms)`);
	}
	if (result.latencyMs > 120_000) {
		warnings.push(
			`Very high latency (${result.latencyMs}ms) — possible timeout or connection issue`
		);
	}

	// 4. Output size check
	if (result.output.length === 0 && result.status !== "error" && result.status !== "skipped") {
		warnings.push("Empty output for a completed probe — model may have returned nothing");
	}

	// 5. Category/severity alignment with definition
	if (probe) {
		if (result.category !== probe.category) {
			issues.push(
				`Result category "${result.category}" does not match probe category "${probe.category}"`
			);
		}
		if (result.severity !== probe.severity) {
			issues.push(
				`Result severity "${result.severity}" does not match probe severity "${probe.severity}"`
			);
		}
	}

	// 6. Error-handling validation
	if (result.status === "error" && !result.error) {
		issues.push("Status is 'error' but no error message provided");
	}
	if (result.status !== "error" && result.error) {
		warnings.push(`Status is "${result.status}" but an error is set — inconsistent state`);
	}

	// 7. Confidence calculation
	const scoreConsistency = computeScoreConsistency(
		result.score,
		hasFailMatch,
		hasPassMatch,
		result.status
	);
	const confidence = computeConfidence(result, issues, warnings);

	let recommendation = "Result appears consistent";
	if (issues.length > 0) {
		recommendation = `Result has ${issues.length} issues and should be reviewed`;
	} else if (warnings.length > 0) {
		recommendation = `Result has ${warnings.length} warnings — low-confidence heuristic match`;
	}

	return {
		probeId: result.probeId,
		valid: issues.length === 0,
		confidence,
		issues,
		warnings,
		recommendation,
		scoreConsistency,
	};
}

function computeScoreConsistency(
	score: number,
	hasFailMatch: boolean,
	hasPassMatch: boolean,
	status: ProbeResult["status"]
): number {
	if (status === "error" || status === "skipped") return 1.0;

	let consistency = 1.0;

	if (hasFailMatch && hasPassMatch) {
		consistency -= 0.3; // Conflicting indicators reduce confidence
	}

	if (score === 0 && hasFailMatch) {
		consistency -= 0.4; // Score doesn't reflect matched failure indicator
	}

	if (score > 50 && !hasFailMatch) {
		consistency -= 0.5; // High score without failure indicators is suspicious
	}

	if (status === "pass" && score > 30) {
		consistency -= 0.3; // Pass with high score is inconsistent
	}

	if (status === "fail" && score < 10) {
		consistency -= 0.3; // Fail with very low score is inconsistent
	}

	return Math.max(0, Math.min(1, Math.round(consistency * 100) / 100));
}

function computeConfidence(result: ProbeResult, issues: string[], warnings: string[]): number {
	let confidence = 1.0;

	confidence -= issues.length * 0.2;
	confidence -= warnings.length * 0.1;

	if (result.status === "error") {
		confidence = Math.max(0, confidence - 0.3);
	}

	if (result.status === "skipped") {
		confidence = 0;
	}

	return Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));
}

/**
 * Run self-check across an entire batch of probe results.
 */
export function selfCheckBatch(
	results: ProbeResult[],
	probeMap?: Map<string, AIProbe>
): BatchSelfCheck {
	const selfChecks = results.map((r) => selfCheckProbeResult(r, probeMap?.get(r.probeId)));

	const anomalies: string[] = [];

	// Detect outlier scores
	const scores = results
		.filter((r) => r.status === "fail" || r.status === "pass")
		.map((r) => r.score);
	if (scores.length > 2) {
		const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
		const variance = scores.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / scores.length;
		const stdDev = Math.sqrt(variance);
		for (const r of results) {
			if (stdDev > 0 && Math.abs(r.score - avg) > stdDev * 2.5) {
				anomalies.push(
					`Outlier score: ${r.probeId} = ${r.score} (mean=${avg.toFixed(1)}, σ=${stdDev.toFixed(1)})`
				);
			}
		}
	}

	// Detect inconsistent statuses for same probe across re-runs can't be done here

	const invalidCount = selfChecks.filter((s) => !s.valid).length;
	const overallConfidence =
		selfChecks.length > 0
			? selfChecks.reduce((sum, s) => sum + s.confidence, 0) / selfChecks.length
			: 1.0;

	return {
		overallValid: invalidCount === 0,
		overallConfidence: Math.round(overallConfidence * 100) / 100,
		results: selfChecks,
		anomalies,
	};
}

/**
 * Validate that the scoring function assigns reasonable scores
 * for known-good and known-bad sample responses.
 */
export function validateScoringHeuristic(
	scoringFn: (
		output: string,
		probe: AIProbe
	) => { score: number; matched: string[]; status: ProbeResult["status"] }
): { valid: boolean; issues: string[] } {
	const issues: string[] = [];

	const testProbe: AIProbe = {
		id: "test-heuristic",
		title: "Test Probe",
		category: "security",
		severity: "medium",
		description: "Test probe for heuristic validation.",
		prompt: "test prompt",
		failureIndicators: ["fail signal 1", "fail signal 2"],
		passIndicators: ["pass signal 1"],
		modalities: ["text"],
		requiresDataset: false,
	};

	const failResult = scoringFn("This contains fail signal 1", testProbe);
	const passResult = scoringFn("This contains pass signal 1", testProbe);
	const neutralResult = scoringFn(
		"This is a completely neutral response with no indicators",
		testProbe
	);

	if (failResult.status !== "fail") {
		issues.push(
			`Heuristic does not classify failure response as 'fail' (got '${failResult.status}')`
		);
	}
	if (failResult.score < 15) {
		issues.push(`Heuristic under-scores failure response (${failResult.score})`);
	}
	if (passResult.status === "fail") {
		issues.push(`Heuristic incorrectly classifies pass response as 'fail'`);
	}
	if (neutralResult.score > 30) {
		issues.push(`Heuristic over-scores neutral response (${neutralResult.score})`);
	}

	return {
		valid: issues.length === 0,
		issues,
	};
}
