/**
 * DFIR Reasoning Enhancements
 *
 * Adapts the 6 AI red-team reasoning patterns (self-check, reasoning traces,
 * tool verification, completion gates, error persistence, executive integration)
 * to the FIND_EVIL disk-forensics workflow.
 */

import path from "node:path";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import type { FindEvilToolName, FindEvilToolResult } from "./types";
import type { FindEvilContext } from "./core";
import {
	addExecutiveItem,
	updateExecutiveItem,
	type ExecutiveItemKind,
	type ExecutiveItemStatus,
} from "../ai/executive-state";

// ────────────────────────────────────────────────────────────────
// 1. Self-Check
// ────────────────────────────────────────────────────────────────

export interface ToolSelfCheck {
	valid: boolean;
	confidence: number; // 0–1
	issues: string[];
	warnings: string[];
	recommendation: string;
}

export interface RunSelfCheck {
	overallValid: boolean;
	overallConfidence: number;
	results: ToolSelfCheck[];
	anomalies: string[];
}

export function selfCheckToolResult(result: FindEvilToolResult): ToolSelfCheck {
	const issues: string[] = [];
	const warnings: string[] = [];

	// 1. Success/failure consistency
	if (!result.success && !result.error) {
		issues.push("Tool failed but no error message was recorded");
	}
	if (result.success && result.error) {
		warnings.push(`Tool succeeded but an error is set: ${result.error}`);
	}

	// 2. Artifact presence check
	const expectedArtifacts: Record<FindEvilToolName, number> = {
		hash_evidence: 1,
		inspect_partitions: 1,
		list_files: 1,
		extract_file_metadata: 1,
		build_timeline: 2,
		search_indicators: 1,
		summarize_findings: 1,
	};
	const minArtifacts = expectedArtifacts[result.tool] ?? 1;
	if (result.success && result.artifacts.length < minArtifacts) {
		warnings.push(
			`Expected at least ${minArtifacts} artifact(s) for ${result.tool}, got ${result.artifacts.length}`
		);
	}

	// 3. Empty-output plausibility
	if (result.success && result.summary.length === 0) {
		warnings.push("Tool succeeded but summary is empty — possible silent failure");
	}

	// 4. Timing sanity
	const started = new Date(result.startedAt).getTime();
	const finished = new Date(result.finishedAt).getTime();
	if (finished < started) {
		issues.push("Finished timestamp is before started timestamp");
	}
	const duration = finished - started;
	if (duration > 120_000) {
		warnings.push(`Very long duration (${duration}ms) — possible timeout or hung tool`);
	}

	// 5. Warnings/error alignment
	if (result.warnings.length > 0 && result.success) {
		warnings.push(`${result.warnings.length} warning(s) emitted despite success status`);
	}

	const confidence = Math.max(0, Math.min(1, 1.0 - issues.length * 0.3 - warnings.length * 0.1));

	let recommendation = "Result appears consistent";
	if (issues.length > 0) {
		recommendation = `Result has ${issues.length} issues and should be reviewed`;
	} else if (warnings.length > 0) {
		recommendation = `Result has ${warnings.length} warnings — confidence is reduced`;
	}

	return {
		valid: issues.length === 0,
		confidence: Math.round(confidence * 100) / 100,
		issues,
		warnings,
		recommendation,
	};
}

export function selfCheckRun(results: FindEvilToolResult[]): RunSelfCheck {
	const checks = results.map(selfCheckToolResult);
	const anomalies: string[] = [];

	// Detect duplicate tool runs
	const toolCounts = new Map<FindEvilToolName, number>();
	for (const r of results) {
		toolCounts.set(r.tool, (toolCounts.get(r.tool) ?? 0) + 1);
	}
	for (const [tool, count] of toolCounts) {
		if (count > 1) {
			anomalies.push(`${tool} was executed ${count} times — possible retry loop`);
		}
	}

	// Detect unexpected tool ordering
	const expectedOrder: FindEvilToolName[] = [
		"hash_evidence",
		"inspect_partitions",
		"list_files",
		"extract_file_metadata",
		"build_timeline",
		"search_indicators",
		"summarize_findings",
	];
	for (let i = 1; i < results.length; i++) {
		const prevIdx = expectedOrder.indexOf(results[i - 1].tool);
		const currIdx = expectedOrder.indexOf(results[i].tool);
		if (currIdx !== -1 && prevIdx !== -1 && currIdx < prevIdx) {
			anomalies.push(`Out-of-order execution: ${results[i].tool} ran after ${results[i - 1].tool}`);
		}
	}

	const invalidCount = checks.filter((c) => !c.valid).length;
	const overallConfidence =
		checks.length > 0 ? checks.reduce((sum, c) => sum + c.confidence, 0) / checks.length : 1.0;

	return {
		overallValid: invalidCount === 0,
		overallConfidence: Math.round(overallConfidence * 100) / 100,
		results: checks,
		anomalies,
	};
}

// ────────────────────────────────────────────────────────────────
// 2. Reasoning Traces
// ────────────────────────────────────────────────────────────────

export interface ReasoningStep {
	order: number;
	action: string;
	observation: string;
	inference: string;
}

export interface ToolReasoningTrace {
	tool: FindEvilToolName;
	timestamp: string;
	steps: ReasoningStep[];
	confidence: number;
}

export interface CaseReasoningTrace {
	caseId: string;
	startedAt: string;
	finishedAt?: string;
	toolTraces: ToolReasoningTrace[];
	completionGate: {
		validated: boolean;
		expectedTools: number;
		actualTools: number;
		missingTools: FindEvilToolName[];
	};
	selfCheck: RunSelfCheck;
	notes: string[];
}

const caseTraceStore = new Map<string, CaseReasoningTrace>();

export function createTriageTracer(caseId: string): {
	logStep: (tool: FindEvilToolName, action: string, observation: string, inference: string) => void;
	buildToolTrace: (tool: FindEvilToolName, confidence: number) => ToolReasoningTrace;
	buildCaseTrace: (
		selfCheck: RunSelfCheck,
		gate: CaseReasoningTrace["completionGate"]
	) => CaseReasoningTrace;
} {
	const toolSteps = new Map<FindEvilToolName, ReasoningStep[]>();

	return {
		logStep(tool, action, observation, inference) {
			const steps = toolSteps.get(tool) ?? [];
			steps.push({ order: steps.length + 1, action, observation, inference });
			toolSteps.set(tool, steps);
		},
		buildToolTrace(tool, confidence): ToolReasoningTrace {
			return {
				tool,
				timestamp: new Date().toISOString(),
				steps: toolSteps.get(tool) ?? [],
				confidence,
			};
		},
		buildCaseTrace(selfCheck, gate): CaseReasoningTrace {
			const trace: CaseReasoningTrace = {
				caseId,
				startedAt: new Date().toISOString(),
				toolTraces: [],
				completionGate: gate,
				selfCheck,
				notes: [],
			};
			caseTraceStore.set(caseId, trace);
			return trace;
		},
	};
}

export function storeCaseTrace(trace: CaseReasoningTrace): void {
	caseTraceStore.set(trace.caseId, trace);
}

export function getCaseTrace(caseId: string): CaseReasoningTrace | undefined {
	return caseTraceStore.get(caseId);
}

export function serializeCaseTrace(trace: CaseReasoningTrace): string {
	return JSON.stringify(trace, null, 2);
}

// ────────────────────────────────────────────────────────────────
// 3. Completion Gates
// ────────────────────────────────────────────────────────────────

const EXPECTED_TOOLS: FindEvilToolName[] = [
	"hash_evidence",
	"inspect_partitions",
	"list_files",
	"extract_file_metadata",
	"build_timeline",
	"search_indicators",
	"summarize_findings",
];

export interface CompletionGateResult {
	valid: boolean;
	expectedTools: number;
	actualTools: number;
	missingTools: FindEvilToolName[];
	unexpectedTools: FindEvilToolName[];
	duplicateTools: FindEvilToolName[];
	warnings: string[];
}

export function validateCompletionGate(results: FindEvilToolResult[]): CompletionGateResult {
	const warnings: string[] = [];
	const seen = new Set<FindEvilToolName>();
	const duplicates: FindEvilToolName[] = [];
	const unexpected: FindEvilToolName[] = [];

	for (const r of results) {
		if (seen.has(r.tool)) {
			duplicates.push(r.tool);
		} else {
			seen.add(r.tool);
		}
		if (!EXPECTED_TOOLS.includes(r.tool)) {
			unexpected.push(r.tool);
		}
	}

	const missing = EXPECTED_TOOLS.filter((t) => !seen.has(t));

	if (missing.length > 0) {
		warnings.push(
			`Missing ${missing.length} expected tool(s): ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "..." : ""}`
		);
	}
	if (duplicates.length > 0) {
		warnings.push(
			`Duplicate tool executions: ${duplicates.slice(0, 3).join(", ")}${duplicates.length > 3 ? "..." : ""}`
		);
	}
	if (unexpected.length > 0) {
		warnings.push(
			`Unexpected tools: ${unexpected.slice(0, 3).join(", ")}${unexpected.length > 3 ? "..." : ""}`
		);
	}

	const failedCount = results.filter((r) => !r.success).length;
	if (failedCount > 0) {
		warnings.push(`${failedCount} tool(s) failed — results may be incomplete`);
	}

	return {
		valid: missing.length === 0 && duplicates.length === 0,
		expectedTools: EXPECTED_TOOLS.length,
		actualTools: seen.size,
		missingTools: missing,
		unexpectedTools: unexpected,
		duplicateTools: duplicates,
		warnings,
	};
}

// ────────────────────────────────────────────────────────────────
// 4. Result Persistence (cross-case trend comparison)
// ────────────────────────────────────────────────────────────────

export interface PersistedCaseRun {
	runId: string;
	caseId: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	toolCount: number;
	successCount: number;
	failureCount: number;
	artifactCount: number;
	warningCount: number;
	selfCheckValid: boolean;
	selfCheckConfidence: number;
	completionGateValid: boolean;
	missingTools: FindEvilToolName[];
	notes?: string[];
}

export interface CaseTrendComparison {
	current: PersistedCaseRun;
	previous?: PersistedCaseRun;
	successChange: number;
	failureChange: number;
	artifactChange: number;
	warningChange: number;
	trend: "improving" | "worsening" | "stable";
	newFailures: FindEvilToolName[];
	fixedFailures: FindEvilToolName[];
	persistingFailures: FindEvilToolName[];
}

const caseRunStore = new Map<string, PersistedCaseRun>();

function generateRunId(): string {
	return `dfir-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function persistCaseRun(
	ctx: FindEvilContext,
	results: FindEvilToolResult[],
	selfCheck: RunSelfCheck,
	gate: CompletionGateResult,
	notes?: string[]
): PersistedCaseRun {
	const runId = generateRunId();
	const started = new Date(results[0]?.startedAt ?? Date.now()).getTime();
	const finished = new Date(results[results.length - 1]?.finishedAt ?? Date.now()).getTime();

	const persisted: PersistedCaseRun = {
		runId,
		caseId: ctx.caseId,
		startedAt: results[0]?.startedAt ?? new Date().toISOString(),
		finishedAt: results[results.length - 1]?.finishedAt ?? new Date().toISOString(),
		durationMs: finished - started,
		toolCount: results.length,
		successCount: results.filter((r) => r.success).length,
		failureCount: results.filter((r) => !r.success).length,
		artifactCount: results.reduce((sum, r) => sum + r.artifacts.length, 0),
		warningCount: results.reduce((sum, r) => sum + r.warnings.length, 0),
		selfCheckValid: selfCheck.overallValid,
		selfCheckConfidence: selfCheck.overallConfidence,
		completionGateValid: gate.valid,
		missingTools: gate.missingTools,
		notes,
	};

	caseRunStore.set(runId, persisted);
	return persisted;
}

export function loadCaseRun(runId: string): PersistedCaseRun | undefined {
	return caseRunStore.get(runId);
}

export function listCaseRunIds(): string[] {
	return Array.from(caseRunStore.values())
		.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
		.map((r) => r.runId);
}

export function getRunsForCase(caseId: string): PersistedCaseRun[] {
	return Array.from(caseRunStore.values())
		.filter((r) => r.caseId === caseId)
		.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

export function compareCaseTrends(
	current: PersistedCaseRun,
	previous?: PersistedCaseRun
): CaseTrendComparison {
	const prev = previous ?? current;
	const successChange = current.successCount - prev.successCount;
	const failureChange = current.failureCount - prev.failureCount;
	const artifactChange = current.artifactCount - prev.artifactCount;
	const warningChange = current.warningCount - prev.warningCount;

	const currFailed = new Set(current.missingTools.filter((t): t is FindEvilToolName => Boolean(t)));
	const prevFailed = new Set(prev.missingTools.filter((t): t is FindEvilToolName => Boolean(t)));

	const newFailures = current.missingTools.filter((t) => !prevFailed.has(t));
	const fixedFailures = prev.missingTools.filter((t) => !currFailed.has(t));
	const persistingFailures = current.missingTools.filter((t) => prevFailed.has(t));

	let trend: CaseTrendComparison["trend"] = "stable";
	if (failureChange < 0 || warningChange < 0) trend = "improving";
	else if (failureChange > 0 || warningChange > 0) trend = "worsening";
	else if (newFailures.length > 0) trend = "worsening";
	else if (fixedFailures.length > 0) trend = "improving";

	return {
		current,
		previous: previous ?? undefined,
		successChange,
		failureChange,
		artifactChange,
		warningChange,
		trend,
		newFailures,
		fixedFailures,
		persistingFailures,
	};
}

export function autoCompareCase(current: PersistedCaseRun): CaseTrendComparison {
	const previous = getRunsForCase(current.caseId).find((r) => r.runId !== current.runId);
	return compareCaseTrends(current, previous);
}

export function serializeAllCaseRuns(): string {
	return JSON.stringify(
		Array.from(caseRunStore.values()).sort(
			(a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
		),
		null,
		2
	);
}

// ────────────────────────────────────────────────────────────────
// 5. Executive Assistant Integration
// ────────────────────────────────────────────────────────────────

export async function pushDfirTask(
	caseId: string,
	phase:
		| "case_opened"
		| "triage_started"
		| "partition_auto_extracted"
		| "self_correction_triggered"
		| "findings_ready"
		| "artifacts_persisted",
	status: ExecutiveItemStatus = "open",
	context?: string
): Promise<void> {
	const titleMap: Record<string, string> = {
		case_opened: `DFIR case opened: ${caseId}`,
		triage_started: `DFIR triage in progress: ${caseId}`,
		partition_auto_extracted: `Auto-extracted partition offset: ${caseId}`,
		self_correction_triggered: `Self-correction triggered: ${caseId}`,
		findings_ready: `DFIR findings ready: ${caseId}`,
		artifacts_persisted: `DFIR artifacts persisted: ${caseId}`,
	};

	const kindMap: Record<string, ExecutiveItemKind> = {
		case_opened: "priority",
		triage_started: "follow_up",
		partition_auto_extracted: "note",
		self_correction_triggered: "risk",
		findings_ready: "decision",
		artifacts_persisted: "follow_up",
	};

	await addExecutiveItem({
		kind: kindMap[phase] ?? "note",
		title: titleMap[phase] ?? `DFIR ${phase}: ${caseId}`,
		status,
		context,
		source: "find-evil",
	});
}

export async function updateDfirTask(
	caseId: string,
	phase: string,
	status: ExecutiveItemStatus
): Promise<void> {
	// Best-effort: we don't track item IDs per phase, so we log a new update item
	await addExecutiveItem({
		kind: "follow_up",
		title: `DFIR update: ${phase} → ${status} for ${caseId}`,
		status,
		context: `Phase ${phase} moved to ${status}`,
		source: "find-evil",
	});
}

// ────────────────────────────────────────────────────────────────
// 6. Artifact helpers
// ────────────────────────────────────────────────────────────────

export async function writeReasoningArtifact(
	ctx: FindEvilContext,
	trace: CaseReasoningTrace
): Promise<void> {
	const target = path.join(ctx.runDir, "reasoning-trace.json");
	await writeFile(target, serializeCaseTrace(trace));
}

export async function writeSelfCheckArtifact(
	ctx: FindEvilContext,
	selfCheck: RunSelfCheck
): Promise<void> {
	const target = path.join(ctx.runDir, "self-check.json");
	await writeFile(target, JSON.stringify(selfCheck, null, 2));
}

export async function writeCompletionGateArtifact(
	ctx: FindEvilContext,
	gate: CompletionGateResult
): Promise<void> {
	const target = path.join(ctx.runDir, "completion-gate.json");
	await writeFile(target, JSON.stringify(gate, null, 2));
}

export async function writeTrendArtifact(
	ctx: FindEvilContext,
	comparison: CaseTrendComparison
): Promise<void> {
	const target = path.join(ctx.runDir, "trend-comparison.json");
	await writeFile(target, JSON.stringify(comparison, null, 2));
}
