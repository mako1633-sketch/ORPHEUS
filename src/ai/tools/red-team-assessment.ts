import { tool } from "ai";
import { z } from "zod";
import {
	buildRedTeamPlaybookCommand,
	buildRedTeamReportMarkdown,
	getRedTeamPlaybook,
	listRedTeamPlaybooks,
	type RedTeamPlaybookId,
	recommendRedTeamPlaybooks,
} from "../../security/red-team-playbooks";
import {
	buildRedTeamScope,
	formatRedTeamScopeMarkdown,
	type RedTeamActivity,
	type RedTeamForbiddenActivity,
} from "../../security/red-team-scope";
import {
	ALL_PROBES,
	countProbes,
	getProbeById,
	getProbesByCategory,
	listProbes,
	type ProbeCategory,
} from "../red-team/probe-library";
import { type SendPromptFn, runBatch } from "../red-team/batch-runner";
import { computeRiskScores } from "../red-team/risk-scorer";
import { generateReport } from "../red-team/report-generator";
import {
	loadProbesFromJSON,
	loadProbesFromYAML,
	buildUnifiedProbeList,
} from "../red-team/probe-registry";
import { parseCSV, parseJSONDataset } from "../red-team/dataset-parser";
import { createMultimodalHarness } from "../red-team/multimodal-harness";
import {
	createScheduledRunner,
	parseScheduleExpression,
	type ScheduleExpression,
	type ScheduledRunConfig,
} from "../red-team/scheduler";
import {
	buildDashboardData,
	generateDashboardMarkdown,
	generateDashboardJSON,
	generateDashboardHTML,
} from "../red-team/dashboard";

const ScopeKindSchema = z.enum(["local-machine", "application", "network", "cloud", "domain"]);
const ActivitySchema = z.enum([
	"passive-recon",
	"configuration-review",
	"dependency-review",
	"safe-service-fingerprinting",
	"authenticated-validation",
	"web-app-validation",
]);
const ForbiddenActivitySchema = z.enum([
	"credential-theft",
	"stealth",
	"persistence",
	"evasion",
	"destructive-testing",
	"third-party-targeting",
	"exploit-chaining",
]);
const PlaybookIdSchema = z.enum([
	"localHostPosture",
	"repoExposureReview",
	"externalDomainRecon",
	"networkServiceReview",
	"webAppHeadersReview",
]);

const ScopeSchema = z.object({
	name: z.string(),
	kind: ScopeKindSchema,
	targets: z.array(z.string()),
	owner: z.string().optional(),
	authorization: z.string().optional(),
	startDate: z.string().optional(),
	endDate: z.string().optional(),
	allowedActivities: z.array(ActivitySchema).optional(),
	forbiddenActivities: z.array(ForbiddenActivitySchema).optional(),
	evidencePath: z.string().optional(),
	notes: z.array(z.string()).optional(),
});

/** In-memory store for loaded custom probes */
const customProbeStore: ReturnType<typeof loadProbesFromJSON>["probes"] = [];

/** In-memory store for scheduled runners */
const scheduledRunners = new Map<string, ReturnType<typeof createScheduledRunner>>();

function getUnifiedProbes() {
	return buildUnifiedProbeList(ALL_PROBES, customProbeStore);
}

export const redTeamAssessment = tool({
	description:
		"Plan authorized defensive red-team assessments. Builds scope packets, recommends vetted low-impact playbooks, returns approval-gated commands, and formats evidence reports. Also supports AI red-team probe management: list, load custom probes, parse datasets, prepare multimodal inputs, schedule recurring runs, and generate live dashboards. Does not execute shell commands.",
	inputSchema: z.object({
		action: z
			.enum([
				"scopeTemplate",
				"validateScope",
				"listPlaybooks",
				"getPlaybook",
				"report",
				"listProbes",
				"getProbe",
				"runProbes",
				"loadProbes",
				"parseDataset",
				"multimodalPrepare",
				"schedule",
				"dashboard",
			])
			.describe(
				"Use scopeTemplate to show required engagement fields, validateScope to normalize authorization/scope, listPlaybooks to show vetted assessment playbooks, getPlaybook to retrieve a playbook command, report to format attached evidence, listProbes to show AI red-team probes, getProbe to retrieve a single probe, runProbes to execute AI probes against a target model, loadProbes to register custom probes from JSON/YAML, parseDataset to parse CSV/JSON datasets for probe substitution, multimodalPrepare to prepare image/voice/document inputs for model testing, schedule to set up recurring probe runs, or dashboard to generate a visual risk dashboard."
			),
		scope: ScopeSchema.optional().describe("Assessment scope and authorization details."),
		playbook: PlaybookIdSchema.optional().describe("Playbook id for getPlaybook or report."),
		evidence: z.string().optional().describe("Command output or notes to include in a report."),
		probeId: z.string().optional().describe("Probe id for getProbe."),
		probeCategory: z
			.enum(["security", "safety", "trustworthiness", "business-alignment"])
			.optional()
			.describe("Filter probes by category for listProbes or runProbes."),
		targetName: z
			.string()
			.optional()
			.describe("Human-readable name of the target AI system for runProbes/report."),
		concurrency: z
			.number()
			.min(1)
			.max(10)
			.optional()
			.describe("Max concurrent probes for runProbes."),
		requestDelayMs: z
			.number()
			.min(0)
			.optional()
			.describe("Delay between probe starts in ms for runProbes."),
		probeTimeoutMs: z.number().min(1000).optional().describe("Timeout per probe in ms."),
		batchTimeoutMs: z.number().min(5000).optional().describe("Total batch timeout in ms."),
		probeData: z
			.string()
			.optional()
			.describe("JSON or YAML probe definition payload for loadProbes."),
		probeFormat: z
			.enum(["json", "yaml"])
			.optional()
			.describe("Format of probeData for loadProbes."),
		dataset: z.string().optional().describe("CSV or JSON dataset payload for parseDataset."),
		datasetFormat: z
			.enum(["csv", "json"])
			.optional()
			.describe("Format of dataset for parseDataset."),
		modality: z
			.enum(["text", "image", "voice", "document"])
			.optional()
			.describe("Input modality for multimodalPrepare."),
		mediaPath: z.string().optional().describe("Local file path to media for multimodalPrepare."),
		mediaBase64: z.string().optional().describe("Base64-encoded media data for multimodalPrepare."),
		mimeType: z.string().optional().describe("MIME type hint for multimodalPrepare."),
		scheduleExpression: z
			.string()
			.optional()
			.describe(
				"Cron-like string (5 fields: min hour dom mon dow) or 'interval:60000' for schedule."
			),
		scheduleId: z.string().optional().describe("Unique ID for a scheduled run."),
		scheduleAction: z
			.enum(["register", "start", "stop", "execute", "history", "list", "unregister"])
			.optional()
			.describe("Action on a scheduled runner."),
		dashboardFormat: z
			.enum(["markdown", "json", "html"])
			.optional()
			.describe("Dashboard output format."),
		previousScoreJson: z
			.string()
			.optional()
			.describe("Optional previous OverallRiskScore JSON for trend comparison in dashboard."),
	}),
	execute: async ({
		action,
		scope,
		playbook,
		evidence,
		probeId,
		probeCategory,
		targetName,
		concurrency,
		requestDelayMs,
		probeTimeoutMs,
		batchTimeoutMs,
		probeData,
		probeFormat,
		dataset,
		datasetFormat,
		modality,
		mediaPath,
		mediaBase64,
		mimeType,
		scheduleExpression,
		scheduleId,
		scheduleAction,
		dashboardFormat,
		previousScoreJson,
	}) => {
		// ── Existing infrastructure red-team actions ──
		if (action === "scopeTemplate") {
			return {
				success: true,
				requiredFields: [
					"name",
					"kind",
					"targets",
					"owner",
					"authorization",
					"startDate",
					"endDate",
				],
				allowedScopeKinds: ScopeKindSchema.options,
				defaultForbiddenActivities: ForbiddenActivitySchema.options,
				note: "Active probing still requires explicit tool approval through runShell/runBash.",
			};
		}

		if (action === "listPlaybooks") {
			return {
				success: true,
				playbooks: listRedTeamPlaybooks().map((item) => ({
					id: item.id,
					title: item.title,
					description: item.description,
					scopeKinds: item.scopeKinds,
					riskLevel: item.riskLevel,
					checkCount: item.checks.length,
				})),
			};
		}

		if (action === "listProbes") {
			const probes = probeCategory ? listProbes({ category: probeCategory }) : getUnifiedProbes();
			return {
				success: true,
				total: countProbes(),
				custom: customProbeStore.length,
				filtered: probes.length,
				probes: probes.map((p) => ({
					id: p.id,
					title: p.title,
					category: p.category,
					severity: p.severity,
					description: p.description,
					modalities: p.modalities,
					requiresDataset: p.requiresDataset,
				})),
			};
		}

		if (action === "getProbe") {
			if (!probeId) {
				return { success: false, error: "Provide a probeId for getProbe." };
			}
			const probe = getProbeById(probeId) ?? customProbeStore.find((p) => p.id === probeId);
			if (!probe) {
				return { success: false, error: `Probe ${probeId} not found.` };
			}
			return {
				success: true,
				probe,
			};
		}

		if (action === "runProbes") {
			const probes = probeCategory
				? getProbesByCategory(probeCategory as ProbeCategory)
				: getUnifiedProbes();
			return {
				success: true,
				ready: false,
				message:
					"AI probe batch configured. To execute, ORPHEUS needs a target model sendPrompt function. Use the active model provider to stream prompts and collect outputs, then pass results back via the report action.",
				config: {
					targetName: targetName ?? "unspecified",
					probes: probes.map((p) => p.id),
					concurrency: concurrency ?? 3,
					requestDelayMs: requestDelayMs ?? 500,
					probeTimeoutMs: probeTimeoutMs ?? 30000,
					batchTimeoutMs: batchTimeoutMs ?? 300000,
				},
				totalProbes: probes.length,
			};
		}

		// ── Custom Probe Registry ──
		if (action === "loadProbes") {
			if (!probeData || !probeFormat) {
				return {
					success: false,
					error: "Provide probeData and probeFormat (json or yaml) for loadProbes.",
				};
			}
			const result =
				probeFormat === "json" ? loadProbesFromJSON(probeData) : loadProbesFromYAML(probeData);
			if (result.success) {
				for (const p of result.probes) {
					const existingIdx = customProbeStore.findIndex((cp) => cp.id === p.id);
					if (existingIdx >= 0) customProbeStore[existingIdx] = p;
					else customProbeStore.push(p);
				}
			}
			return {
				success: result.success,
				loaded: result.probes.length,
				totalCustom: customProbeStore.length,
				errors: result.errors,
			};
		}

		// ── Dataset Parser ──
		if (action === "parseDataset") {
			if (!dataset || !datasetFormat) {
				return {
					success: false,
					error: "Provide dataset and datasetFormat (csv or json) for parseDataset.",
				};
			}
			const parsed = datasetFormat === "csv" ? parseCSV(dataset) : parseJSONDataset(dataset);
			return {
				success: parsed.success,
				rows: parsed.rows.slice(0, 5),
				headers: parsed.headers,
				totalRows: parsed.totalRows,
				errors: parsed.errors,
			};
		}

		// ── Multimodal Harness ──
		if (action === "multimodalPrepare") {
			if (!modality) {
				return { success: false, error: "Provide modality for multimodalPrepare." };
			}
			const harness = createMultimodalHarness();
			const input = {
				modality,
				prompt: evidence ?? "",
				mediaPath,
				mediaBase64,
				mimeType,
			};
			try {
				const prepared = await harness.prepare(input);
				return {
					success: true,
					modality: prepared.modality,
					text: prepared.text,
					imageDataUri: prepared.imageDataUri,
					voiceInfo: prepared.voiceInfo,
					documentText: prepared.documentText,
					warnings: prepared.preparationMeta.warnings,
					method: prepared.preparationMeta.method,
				};
			} catch (e) {
				return {
					success: false,
					error: e instanceof Error ? e.message : String(e),
				};
			}
		}

		// ── Scheduling ──
		if (action === "schedule") {
			if (!scheduleId || !scheduleAction) {
				return {
					success: false,
					error: "Provide scheduleId and scheduleAction for schedule.",
				};
			}

			if (scheduleAction === "list") {
				const ids = Array.from(scheduledRunners.keys());
				const histories = ids.map((id) => {
					const runner = scheduledRunners.get(id)!;
					const h = runner.getHistory(id);
					return { id, totalRuns: h?.totalRuns ?? 0, isRunning: h?.isRunning ?? false };
				});
				return { success: true, schedules: histories };
			}

			if (scheduleAction === "unregister") {
				const runner = scheduledRunners.get(scheduleId);
				if (runner) {
					runner.unregister(scheduleId);
					scheduledRunners.delete(scheduleId);
				}
				return { success: true, id: scheduleId, status: "unregistered" };
			}

			let runner = scheduledRunners.get(scheduleId);

			if (scheduleAction === "register") {
				if (!scheduleExpression || !targetName) {
					return {
						success: false,
						error: "Provide scheduleExpression and targetName to register a schedule.",
					};
				}
				const probes = probeCategory
					? getProbesByCategory(probeCategory as ProbeCategory).map((p) => p.id)
					: getUnifiedProbes().map((p) => p.id);
				let schedule: ScheduleExpression;
				try {
					if (scheduleExpression.startsWith("interval:")) {
						const ms = Number.parseInt(scheduleExpression.replace("interval:", ""), 10);
						if (Number.isNaN(ms)) throw new Error("Invalid interval");
						schedule = { intervalMs: ms };
					} else {
						schedule = parseScheduleExpression(scheduleExpression);
					}
				} catch (e) {
					return {
						success: false,
						error: `Invalid schedule expression: ${e instanceof Error ? e.message : String(e)}`,
					};
				}
				const config: ScheduledRunConfig = {
					id: scheduleId,
					name: targetName,
					schedule,
					probeIds: probes,
					targetName,
					concurrency: concurrency ?? 3,
					requestDelayMs: requestDelayMs ?? 500,
					probeTimeoutMs: probeTimeoutMs ?? 30000,
					batchTimeoutMs: batchTimeoutMs ?? 300000,
					autoStart: false,
				};
				if (!runner) {
					runner = createScheduledRunner();
					scheduledRunners.set(scheduleId, runner);
				}
				runner.register(config);
				return {
					success: true,
					id: scheduleId,
					status: "registered",
					config,
				};
			}

			if (!runner) {
				return { success: false, error: `Schedule "${scheduleId}" not found. Register it first.` };
			}

			if (
				(scheduleAction === "start" || scheduleAction === "execute") &&
				!runner.hasRunCallbacks()
			) {
				return {
					success: false,
					id: scheduleId,
					error:
						"Schedule is registered, but no probe executor is configured in this tool context. Use executeAIProbeBatch with an explicit sendPrompt executor, or register a runner callback before starting scheduled runs.",
				};
			}

			if (scheduleAction === "start") {
				runner.start(scheduleId);
				return { success: true, id: scheduleId, status: "started" };
			}
			if (scheduleAction === "stop") {
				runner.stop(scheduleId);
				return { success: true, id: scheduleId, status: "stopped" };
			}
			if (scheduleAction === "history") {
				const h = runner.getHistory(scheduleId);
				return {
					success: true,
					id: scheduleId,
					history: h
						? {
								totalRuns: h.totalRuns,
								isRunning: h.isRunning,
								lastRunAt: h.lastRunAt,
								nextRunAt: h.nextRunAt,
								results: h.results.slice(-5),
							}
						: null,
				};
			}
			if (scheduleAction === "execute") {
				const result = await runner.execute(scheduleId);
				return {
					success: true,
					id: scheduleId,
					result: {
						status: result.status,
						startedAt: result.startedAt,
						finishedAt: result.finishedAt,
						error: result.error,
					},
				};
			}

			return { success: false, error: `Unknown scheduleAction: ${scheduleAction}` };
		}

		// ── Dashboard ──
		if (action === "dashboard") {
			if (!evidence) {
				return {
					success: false,
					error: "Provide evidence as OverallRiskScore JSON string for dashboard.",
				};
			}
			let score: ReturnType<typeof computeRiskScores>;
			let previousScore: ReturnType<typeof computeRiskScores> | undefined;
			try {
				score = JSON.parse(evidence);
			} catch (e) {
				return {
					success: false,
					error: `Invalid score JSON: ${e instanceof Error ? e.message : String(e)}`,
				};
			}
			if (previousScoreJson) {
				try {
					previousScore = JSON.parse(previousScoreJson);
				} catch {
					// ignore invalid previous score
				}
			}
			const data = buildDashboardData({
				title: targetName ? `${targetName} — Risk Dashboard` : "AI Red Team Dashboard",
				score,
				durationMs: 0,
				totalProbes: score.categoryScores.reduce((sum, c) => sum + c.total, 0),
				previousScore,
			});
			const format = dashboardFormat ?? "markdown";
			let output: string;
			if (format === "json") output = generateDashboardJSON(data);
			else if (format === "html") output = generateDashboardHTML(data);
			else output = generateDashboardMarkdown(data);
			return {
				success: true,
				format,
				output,
				overallScore: data.overallScore,
				overallSeverity: data.overallSeverity,
			};
		}

		if (!scope) {
			return {
				success: false,
				error: "Provide a scope for this red-team assessment action.",
			};
		}

		const normalizedScope = buildRedTeamScope({
			...scope,
			allowedActivities: scope.allowedActivities as RedTeamActivity[] | undefined,
			forbiddenActivities: scope.forbiddenActivities as RedTeamForbiddenActivity[] | undefined,
		});

		if (action === "validateScope") {
			return {
				success: true,
				scope: normalizedScope,
				markdown: formatRedTeamScopeMarkdown(normalizedScope),
				recommendedPlaybooks: recommendRedTeamPlaybooks(normalizedScope).map((item) => item.id),
			};
		}

		if (!playbook) {
			return {
				success: false,
				error: "Provide a playbook id for this action.",
			};
		}

		const selected = getRedTeamPlaybook(playbook as RedTeamPlaybookId);
		if (!selected.scopeKinds.includes(normalizedScope.kind)) {
			return {
				success: false,
				error: `Playbook ${selected.id} is not intended for ${normalizedScope.kind} scope.`,
				scope: normalizedScope,
				recommendedPlaybooks: recommendRedTeamPlaybooks(normalizedScope).map((item) => item.id),
			};
		}

		if (!normalizedScope.ready) {
			return {
				success: false,
				error: "Scope is not ready. Complete missing authorization fields before using a playbook.",
				scope: normalizedScope,
			};
		}

		if (action === "getPlaybook") {
			return {
				success: true,
				scope: normalizedScope,
				playbook: {
					id: selected.id,
					title: selected.title,
					description: selected.description,
					scopeKinds: selected.scopeKinds,
					riskLevel: selected.riskLevel,
					checks: selected.checks,
					disallowed: selected.disallowed,
					command: buildRedTeamPlaybookCommand(selected.id),
				},
				approvalRequired: selected.checks.some((check) => check.requiresApproval),
			};
		}

		return {
			success: true,
			scope: normalizedScope,
			playbook: selected,
			report: buildRedTeamReportMarkdown({
				scope: normalizedScope,
				playbook: selected,
				evidence,
			}),
		};
	},
});

/**
 * Execute a configured AI red-team probe batch against a real model.
 * This is designed to be called from within ORPHEUS's agent runner
 * when the user confirms execution of a probe run.
 */
export async function executeAIProbeBatch(
	config: {
		targetName: string;
		probeIds: string[];
		concurrency?: number;
		requestDelayMs?: number;
		probeTimeoutMs?: number;
		batchTimeoutMs?: number;
	},
	sendPrompt: SendPromptFn
) {
	const probes = config.probeIds
		.map((id) => getProbeById(id) ?? customProbeStore.find((p) => p.id === id))
		.filter((p): p is NonNullable<typeof p> => p !== undefined);

	const summary = await runBatch(
		{
			probes,
			concurrency: config.concurrency ?? 3,
			requestDelayMs: config.requestDelayMs ?? 500,
			probeTimeoutMs: config.probeTimeoutMs ?? 30000,
			batchTimeoutMs: config.batchTimeoutMs ?? 300000,
			maxRetries: 1,
			retryDelayMs: 1000,
		},
		sendPrompt
	);

	const riskScore = computeRiskScores(summary.results);
	const report = generateReport({
		targetName: config.targetName,
		batchSummary: summary,
		riskScore,
	});

	return { summary, riskScore, report };
}
