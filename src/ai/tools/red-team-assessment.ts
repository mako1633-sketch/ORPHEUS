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

export const redTeamAssessment = tool({
	description:
		"Plan authorized defensive red-team assessments. Builds scope packets, recommends vetted low-impact playbooks, returns approval-gated commands, and formats evidence reports. Does not execute commands.",
	inputSchema: z.object({
		action: z
			.enum(["scopeTemplate", "validateScope", "listPlaybooks", "getPlaybook", "report"])
			.describe(
				"Use scopeTemplate to show required engagement fields, validateScope to normalize authorization/scope, listPlaybooks to show vetted assessment playbooks, getPlaybook to retrieve a playbook command, or report to format attached evidence."
			),
		scope: ScopeSchema.optional().describe("Assessment scope and authorization details."),
		playbook: PlaybookIdSchema.optional().describe("Playbook id for getPlaybook or report."),
		evidence: z.string().optional().describe("Command output or notes to include in a report."),
	}),
	execute: async ({ action, scope, playbook, evidence }) => {
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
