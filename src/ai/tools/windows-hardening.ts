import { tool } from "ai";
import { z } from "zod";
import {
	getWindowsHardeningRulesForProfile,
	listWindowsHardeningProfiles,
	type WindowsHardeningProfileId,
} from "../../security/windows-hardening-baselines";
import {
	buildHardeningCheckCommand,
	buildPolicyCheckCommand,
	buildWindowsHardeningPlan,
} from "../../security/windows-hardening-planner";
import { listWindowsEventTriageQueries } from "../../security/windows-event-triage";
import { scoreWindowsProcess } from "../../security/windows-process-scoring";
import {
	buildWindowsSecurityScheduledTaskInventoryCommand,
	buildWindowsSecurityScheduledTaskPlan,
	listWindowsSecurityScheduledTaskTemplates,
	type WindowsSecurityScheduledTaskOperation,
	type WindowsSecurityScheduledTaskTemplateId,
} from "../../security/windows-scheduled-tasks";
import { listWindowsWatchRules } from "../../security/windows-watch-rules";

const ProfileSchema = z.enum([
	"homeWorkstation",
	"developerWorkstation",
	"highSecurityLaptop",
	"smallBusinessEndpoint",
	"serverLite",
]);
const ScheduledTaskTemplateSchema = z.enum([
	"defenderQuickScanDaily",
	"defenderFullScanWeekly",
	"securityEventExportDaily",
]);
const ScheduledTaskOperationSchema = z.enum(["create", "update", "enable", "disable", "delete"]);

export const windowsHardening = tool({
	description:
		"Plan advanced defensive Windows hardening. Provides named hardening profiles, baseline rules, read-only check commands, policy-aware planning, rollback commands, watch rules, event triage queries, suspicious-process scoring, and approval-ready security scheduled-task plans. Never applies changes directly.",
	inputSchema: z.object({
		action: z.enum([
			"profiles",
			"rules",
			"plan",
			"checkCommand",
			"policyCommand",
			"watchRules",
			"eventTriage",
			"scoreProcess",
			"scheduledTaskTemplates",
			"scheduledTaskInventoryCommand",
			"scheduledTaskPlan",
		]),
		profile: ProfileSchema.optional().describe("Hardening profile for rules, plan, and command actions."),
		scheduledTaskTemplate: ScheduledTaskTemplateSchema.optional().describe(
			"Security scheduled-task template."
		),
		scheduledTaskOperation: ScheduledTaskOperationSchema.optional().describe(
			"Scheduled-task operation to plan."
		),
		process: z
			.object({
				name: z.string(),
				path: z.string().optional(),
				signed: z.boolean().optional(),
				listeningPort: z.number().optional(),
				runsAsAdmin: z.boolean().optional(),
				company: z.string().optional(),
				recentlyCreated: z.boolean().optional(),
				parentProcess: z.string().optional(),
			})
			.optional(),
	}),
	execute: async ({ action, profile, scheduledTaskTemplate, scheduledTaskOperation, process }) => {
		if (action === "profiles") {
			return { success: true, profiles: listWindowsHardeningProfiles() };
		}

		if (action === "watchRules") {
			return { success: true, rules: listWindowsWatchRules() };
		}

		if (action === "eventTriage") {
			return { success: true, queries: listWindowsEventTriageQueries() };
		}

		if (action === "scoreProcess") {
			if (!process) return { success: false, error: "Provide process signals to score." };
			return { success: true, score: scoreWindowsProcess(process) };
		}

		if (action === "scheduledTaskTemplates") {
			return { success: true, templates: listWindowsSecurityScheduledTaskTemplates() };
		}

		if (action === "scheduledTaskInventoryCommand") {
			return { success: true, command: buildWindowsSecurityScheduledTaskInventoryCommand() };
		}

		if (action === "scheduledTaskPlan") {
			if (!scheduledTaskTemplate || !scheduledTaskOperation) {
				return {
					success: false,
					error: "Provide scheduledTaskTemplate and scheduledTaskOperation.",
				};
			}
			return {
				success: true,
				plan: buildWindowsSecurityScheduledTaskPlan(
					scheduledTaskOperation as WindowsSecurityScheduledTaskOperation,
					scheduledTaskTemplate as WindowsSecurityScheduledTaskTemplateId
				),
			};
		}

		if (!profile) {
			return { success: false, error: "Provide a hardening profile." };
		}

		const profileId = profile as WindowsHardeningProfileId;
		if (action === "rules") {
			return { success: true, profile: profileId, rules: getWindowsHardeningRulesForProfile(profileId) };
		}
		if (action === "plan") {
			return { success: true, plan: buildWindowsHardeningPlan(profileId) };
		}
		if (action === "checkCommand") {
			return { success: true, profile: profileId, command: buildHardeningCheckCommand(profileId) };
		}
		if (action === "policyCommand") {
			return { success: true, profile: profileId, command: buildPolicyCheckCommand(profileId) };
		}

		return { success: false, error: "Unsupported hardening action." };
	},
});
