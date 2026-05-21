/**
 * ORPHEUS AI Red Teaming Module
 *
 * Competes with Zscaler AI Red Teaming benchmark:
 * - 25+ predefined probes across 4 risk categories
 * - Batch runner with concurrency and rate-limit awareness
 * - Risk scoring and aggregation
 * - Shareable Markdown / JSON reports
 * - Custom probe registry (JSON / YAML)
 * - Dataset upload parser (CSV / JSON)
 * - Multimodal execution harness (image / voice / document)
 * - Scheduling (cron / recurring runner)
 * - Live dashboard (visual risk charts)
 * - Reasoning traces for auditability
 * - Result persistence for trend comparison
 * - Self-check / verification for probe scoring
 * - Scheduler persistence across restarts
 * - Completion gates for batch validation
 */

export {
	ALL_PROBES,
	SECURITY_PROBES,
	SAFETY_PROBES,
	TRUSTWORTHINESS_PROBES,
	BUSINESS_ALIGNMENT_PROBES,
	getProbeById,
	listProbes,
	getProbesByCategory,
	countProbes,
} from "./probe-library";

export type {
	AIProbe,
	ProbeCategory,
	ProbeSeverity,
	ProbeStatus,
	ProbeResult,
} from "./probe-library";

export {
	runBatch,
	DEFAULT_CONFIG as BATCH_DEFAULT_CONFIG,
} from "./batch-runner";

export type {
	BatchRunConfig,
	BatchRunSummary,
	BatchProgress,
	SendPromptFn,
	BatchProgressCallback,
} from "./batch-runner";

export {
	computeRiskScores,
	SEVERITY_WEIGHTS,
} from "./risk-scorer";

export type {
	CategoryRiskScore,
	OverallRiskScore,
} from "./risk-scorer";

export { generateReport } from "./report-generator";

export type {
	ReportInput,
	GeneratedReport,
} from "./report-generator";

// ── Custom Probe Registry ──

export {
	loadProbesFromJSON,
	loadProbesFromYAML,
	buildUnifiedProbeList,
	serializeProbeToJSON,
	serializeProbesToYAML,
} from "./probe-registry";

export type {
	CustomProbeDefinition,
	RegistryLoadResult,
} from "./probe-registry";

// ── Dataset Parser ──

export {
	parseCSV,
	parseJSONDataset,
	substituteTemplate,
	expandProbeWithDataset,
} from "./dataset-parser";

export type {
	DatasetRow,
	ParsedDataset,
} from "./dataset-parser";

// ── Multimodal Harness ──

export {
	createMultimodalHarness,
	MultimodalHarness,
	ImageAdapter,
	VoiceAdapter,
	DocumentAdapter,
	TextAdapter,
} from "./multimodal-harness";

export type {
	Modality,
	MultimodalInput,
	PreparedPrompt,
	ModalityAdapter,
} from "./multimodal-harness";

// ── Scheduling ──

export {
	createScheduledRunner,
	ScheduleRunner,
	parseScheduleExpression,
} from "./scheduler";

export type {
	ScheduleExpression,
	ScheduledRunConfig,
	ScheduledRunResult,
	ScheduledRunHistory,
} from "./scheduler";

// ── Scheduler Persistence ──

export {
	setPersistencePath,
	persistSchedules,
	loadSchedules,
	isPersistenceEnabled,
	clearPersistence,
	hydrateScheduleRunner,
} from "./scheduler-persistence";

export type { PersistedSchedule } from "./scheduler-persistence";

// ── Live Dashboard ──

export {
	generateDashboardMarkdown,
	generateDashboardJSON,
	generateDashboardHTML,
	buildDashboardData,
} from "./dashboard";

export type {
	DashboardData,
	DashboardChart,
	DashboardMetric,
	DashboardSeverityBlock,
} from "./dashboard";

// ── Reasoning Traces ──

export {
	createProbeTracer,
	traceCategoryReasoning,
	traceOverallReasoning,
	storeTrace,
	getTrace,
	listTraceIds,
	purgeTracesOlderThan,
	serializeTrace,
	traceCount,
} from "./reasoning-trace";

export type {
	ProbeReasoningTrace,
	ReasoningStep,
	CategoryReasoningTrace,
	OverallReasoningTrace,
	BatchReasoningTrace,
} from "./reasoning-trace";

// ── Result Persistence ──

export {
	persistRun,
	loadRun,
	listRunIds,
	getRunsForTarget,
	compareTrends,
	autoCompare,
	purgeOldRuns,
	serializeAllRuns,
	deserializeRuns,
	persistedRunCount,
} from "./result-persistence";

export type {
	PersistedRun,
	TrendComparison,
} from "./result-persistence";

// ── Self-Check / Verification ──

export {
	selfCheckProbeResult,
	selfCheckBatch,
	validateScoringHeuristic,
} from "./self-check";

export type {
	SelfCheckResult,
	BatchSelfCheck,
} from "./self-check";

// ── Completion Gates ──

export {
	validateBatchGates,
	resultsNotEmpty,
	cancelledGate,
	DEFAULT_GATE_CONFIG,
} from "./completion-gate";

export type {
	CompletionGateResult,
	CompletionGateConfig,
} from "./completion-gate";
