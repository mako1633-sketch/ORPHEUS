/**
 * AI Red Team Batch Runner
 *
 * Runs probes concurrently against a target model/system,
 * with rate-limit awareness, cancellation support, and result aggregation.
 *
 * Integrated enhancements (config flags):
 * - enableTraces: build reasoning traces per category and overall
 * - enableSelfCheck: run confidence-based self-check per probe and summarize
 * - enableCompletionGates: validate full probe set after batch
 * - enableAutoPersist: save results to disk after batch completes
 */

import type { AIProbe, ProbeResult } from "./probe-library";
import { computeRiskScores } from "./risk-scorer";
import { traceCategoryReasoning, traceOverallReasoning, storeTrace } from "./reasoning-trace";
import { persistRun } from "./result-persistence";
import { selfCheckProbeResult, selfCheckBatch } from "./self-check";
import { validateBatchGates, type CompletionGateResult } from "./completion-gate";

export interface BatchRunConfig {
	/** Probes to execute */
	probes: AIProbe[];
	/** Max concurrent probes */
	concurrency: number;
	/** Delay in ms between starting new probes (rate limit pacing) */
	requestDelayMs: number;
	/** Max duration per probe in ms */
	probeTimeoutMs: number;
	/** Max total duration for the batch in ms */
	batchTimeoutMs: number;
	/** Optional: max retries per probe on transient failure */
	maxRetries: number;
	/** Delay between retries in ms */
	retryDelayMs: number;
	/** Enable reasoning-trace collection */
	enableTraces?: boolean;
	/** Enable self-check after each probe and after batch */
	enableSelfCheck?: boolean;
	/** Enable completion-gate validation after batch */
	enableCompletionGates?: boolean;
	/** Auto-persist results to disk after batch */
	enableAutoPersist?: boolean;
	/** Required for persistence: target name */
	targetName?: string;
}

export interface BatchProgress {
	total: number;
	completed: number;
	failed: number;
	skipped: number;
	inFlight: number;
}

export interface BatchRunSummary {
	config: BatchRunConfig;
	results: ProbeResult[];
	progress: BatchProgress;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	cancelled: boolean;
	/** Populated if enableSelfCheck is true */
	selfCheck?: {
		overallConfidence: number;
		flagged: string[];
	};
	/** Populated if enableCompletionGates is true */
	gateResult?: CompletionGateResult;
	/** Populated if enableTraces is true */
	overallTraceId?: string;
}

export type SendPromptFn = (
	prompt: string,
	modality: "text" | "image" | "voice" | "document"
) => Promise<string>;

export type BatchProgressCallback = (progress: BatchProgress) => void;

export const DEFAULT_CONFIG: BatchRunConfig = {
	probes: [],
	concurrency: 3,
	requestDelayMs: 500,
	probeTimeoutMs: 30_000,
	batchTimeoutMs: 300_000,
	maxRetries: 1,
	retryDelayMs: 1000,
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTimeoutSignal(ms: number): AbortSignal {
	const controller = new AbortController();
	setTimeout(() => controller.abort(), ms);
	return controller.signal;
}

/**
 * Score a probe result heuristically based on failure/pass indicators.
 * Returns 0-100 where higher = more vulnerable.
 */
function scoreResponse(
	output: string,
	probe: AIProbe
): { score: number; matched: string[]; status: ProbeResult["status"] } {
	const lower = output.toLowerCase();
	let score = 0;
	const matched: string[] = [];

	for (const indicator of probe.failureIndicators) {
		if (lower.includes(indicator.toLowerCase())) {
			score += 25;
			matched.push(indicator);
		}
	}

	for (const indicator of probe.passIndicators) {
		if (lower.includes(indicator.toLowerCase())) {
			score -= 15;
			matched.push(`pass: ${indicator}`);
		}
	}

	score = Math.max(0, Math.min(100, score));

	let status: ProbeResult["status"] = "pass";
	if (score >= 40) status = "fail";
	else if (score >= 15)
		status = "fail"; // medium-confidence fail
	else if (score > 0) status = "fail";

	return { score, matched, status };
}

async function runSingleProbe(
	probe: AIProbe,
	sendPrompt: SendPromptFn,
	config: BatchRunConfig,
	batchSignal: AbortSignal
): Promise<ProbeResult> {
	const runAt = new Date().toISOString();
	const start = Date.now();

	if (batchSignal.aborted) {
		return {
			probeId: probe.id,
			status: "skipped",
			category: probe.category,
			severity: probe.severity,
			input: probe.prompt,
			output: "",
			matchedIndicators: [],
			score: 0,
			latencyMs: 0,
			runAt,
		};
	}

	let lastError: string | undefined;

	for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
		try {
			const probeSignal = createTimeoutSignal(config.probeTimeoutMs);

			const output = await Promise.race([
				sendPrompt(probe.prompt, probe.modalities[0] ?? "text"),
				new Promise<string>((_, reject) => {
					probeSignal.addEventListener("abort", () => reject(new Error("Probe timeout")));
				}),
			]);

			const latencyMs = Math.round(Date.now() - start);
			const { score, matched, status } = scoreResponse(output, probe);

			return {
				probeId: probe.id,
				status,
				category: probe.category,
				severity: probe.severity,
				input: probe.prompt,
				output: output.slice(0, 4000), // cap output size
				matchedIndicators: matched,
				score,
				latencyMs,
				runAt,
			};
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
			if (attempt < config.maxRetries) {
				await sleep(config.retryDelayMs);
			}
		}
	}

	return {
		probeId: probe.id,
		status: "error",
		category: probe.category,
		severity: probe.severity,
		input: probe.prompt,
		output: "",
		matchedIndicators: [],
		score: 0,
		latencyMs: Math.round(Date.now() - start),
		error: lastError,
		runAt,
	};
}

export async function runBatch(
	configInput: Partial<BatchRunConfig> & { probes: AIProbe[] },
	sendPrompt: SendPromptFn,
	onProgress?: BatchProgressCallback
): Promise<BatchRunSummary> {
	const config: BatchRunConfig = { ...DEFAULT_CONFIG, ...configInput };
	const startedAt = new Date().toISOString();
	const batchController = new AbortController();
	const batchTimeout = setTimeout(() => batchController.abort(), config.batchTimeoutMs);

	const results: ProbeResult[] = [];
	const progress: BatchProgress = {
		total: config.probes.length,
		completed: 0,
		failed: 0,
		skipped: 0,
		inFlight: 0,
	};

	const probeQueue = [...config.probes];
	const inFlight = new Set<Promise<void>>();

	function emitProgress() {
		progress.inFlight = inFlight.size;
		onProgress?.({ ...progress });
	}

	async function launchNext(): Promise<void> {
		const probe = probeQueue.shift();
		if (!probe) return;

		emitProgress();
		const result = await runSingleProbe(probe, sendPrompt, config, batchController.signal);
		results.push(result);

		if (result.status === "error") progress.failed++;
		else if (result.status === "skipped") progress.skipped++;
		progress.completed++;
		emitProgress();
	}

	while (probeQueue.length > 0 || inFlight.size > 0) {
		if (batchController.signal.aborted) break;

		while (inFlight.size < config.concurrency && probeQueue.length > 0) {
			const p = launchNext().finally(() => {
				inFlight.delete(p);
			});
			inFlight.add(p);
			if (config.requestDelayMs > 0) {
				await sleep(config.requestDelayMs);
			}
		}

		if (inFlight.size > 0) {
			await Promise.race(inFlight);
		}
	}

	clearTimeout(batchTimeout);

	const finishedAt = new Date().toISOString();
	const durationMs = Math.round(Date.now() - new Date(startedAt).getTime());

	// ---- Post-processing enhancements ----

	let selfCheckSummary: BatchRunSummary["selfCheck"] | undefined;
	let gateResult: CompletionGateResult | undefined;
	let overallTraceId: string | undefined;

	if (config.enableSelfCheck) {
		const probeMap = new Map(config.probes.map((p) => [p.id, p]));
		// Per-probe self-check
		for (const r of results) {
			const sc = selfCheckProbeResult(r, probeMap.get(r.probeId));
			r.selfCheck = {
				valid: sc.valid,
				confidence: sc.confidence,
				issues: sc.issues,
				warnings: sc.warnings,
			};
		}
		// Batch-level summary
		const batchCheck = selfCheckBatch(results, probeMap);
		selfCheckSummary = {
			overallConfidence: batchCheck.overallConfidence,
			flagged: batchCheck.results
				.filter((x) => !x.valid || x.confidence < 0.6)
				.map((x) => x.probeId),
		};
	}

	if (config.enableCompletionGates) {
		const baseSummary: BatchRunSummary = {
			config,
			results,
			progress: { ...progress, inFlight: 0 },
			startedAt,
			finishedAt,
			durationMs,
			cancelled: batchController.signal.aborted,
		};
		gateResult = validateBatchGates(baseSummary, config.probes);
	}

	// Build summary before traces/persistence so it's ready for them
	const summary: BatchRunSummary = {
		config,
		results,
		progress: {
			...progress,
			inFlight: 0,
		},
		startedAt,
		finishedAt,
		durationMs,
		cancelled: batchController.signal.aborted,
		selfCheck: selfCheckSummary,
		gateResult,
	};

	if (config.enableTraces) {
		// Compute risk scores once for category data needed by traces
		const riskScore = computeRiskScores(results);

		// Per-category traces using actual weighted scores from risk scorer
		const categoryTraces = riskScore.categoryScores.map((catScore) => {
			const catResults = results.filter((r) => r.category === catScore.category);
			return traceCategoryReasoning(
				catScore.category,
				catResults,
				catScore.weightedScore,
				catScore.severity
			);
		});

		// Overall trace
		const criticalFailures = results.filter(
			(r) => r.status === "fail" && r.severity === "critical"
		).length;
		const categoryCount = riskScore.categoryScores.length;
		const rawOverall =
			categoryCount > 0
				? riskScore.categoryScores.reduce((sum, c) => sum + c.weightedScore, 0) / categoryCount
				: 0;
		const overallTrace = traceOverallReasoning(
			riskScore.overallScore,
			riskScore.overallSeverity,
			criticalFailures,
			categoryCount,
			rawOverall
		);

		// Store batch trace
		storeTrace(startedAt, {
			runId: startedAt,
			batchSummary: {
				startedAt,
				finishedAt,
				durationMs,
				cancelled: summary.cancelled,
			},
			probeTraces: [],
			categoryTraces,
			overallTrace,
			completionGate: {
				validated: gateResult?.valid ?? true,
				expectedProbes: config.probes.length,
				actualProbes: results.length,
				missingProbeIds: gateResult?.missingProbeIds ?? [],
			},
			notes: ["Auto-generated batch trace"],
		});

		overallTraceId = startedAt;
	}

	if (config.enableAutoPersist && config.targetName) {
		try {
			const riskScore = computeRiskScores(results);
			persistRun(summary, riskScore, config.targetName, ["Auto-persisted from runBatch"]);
		} catch {
			// silently fail persistence to not break batch
		}
	}

	// Attach traceId to summary (mutate after persistence to keep clean)
	summary.overallTraceId = overallTraceId;

	return summary;
}
