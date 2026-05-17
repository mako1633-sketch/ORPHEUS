import { tool } from "ai";
import { z } from "zod";
import {
	listWindowsAssessmentHistory,
	saveWindowsAssessmentRecord,
} from "../../security/windows-assessment-history";
import { parseWindowsAssessmentOutput } from "../../security/windows-assessment-parser";
import { buildWindowsRemediationPlan } from "../../security/windows-remediation";
import {
	buildWindowsSecurityPlaybookCommand,
	getWindowsSecurityPlaybook,
	listWindowsSecurityPlaybooks,
	type WindowsSecurityPlaybookId,
} from "../../security/windows-security-playbooks";
import { buildWindowsSecurityReport } from "../../security/windows-security-report";

const PlaybookIdSchema = z.enum([
	"quickPosture",
	"defenderFirewall",
	"patchPosture",
	"startupPersistence",
	"networkReview",
	"suspiciousProcessTriage",
	"securitySignalsReview",
	"fullReadOnlyAssessment",
]);

export const windowsSecurity = tool({
	description:
		"Return vetted read-only Windows security assessment playbooks and PowerShell commands. Use this before runShell/runBash for local Windows vulnerability or posture assessments so commands come from the approved library.",
	inputSchema: z.object({
		action: z
			.enum(["list", "get", "parse", "history"])
			.describe(
				"Use list to show playbooks, get to retrieve a playbook command, parse to structure output, or history to list prior parsed assessments."
			),
		playbook: PlaybookIdSchema.optional().describe("Playbook id to retrieve when action is get."),
		output: z
			.string()
			.optional()
			.describe("Raw PowerShell assessment output to parse when action is parse."),
		save: z
			.boolean()
			.optional()
			.describe("When parsing, save the parsed assessment to local history."),
	}),
	execute: async ({ action, playbook, output, save }) => {
		if (action === "list") {
			return {
				success: true,
				playbooks: listWindowsSecurityPlaybooks().map((item) => ({
					id: item.id,
					title: item.title,
					description: item.description,
					riskLevel: item.riskLevel,
					checkCount: item.checks.length,
				})),
			};
		}

		if (action === "history") {
			return {
				success: true,
				records: await listWindowsAssessmentHistory(),
			};
		}

		if (action === "parse") {
			if (!output?.trim()) {
				return {
					success: false,
					error: "Provide assessment output to parse.",
				};
			}
			const findings = parseWindowsAssessmentOutput(output);
			const remediationPlan = buildWindowsRemediationPlan(findings);
			const report = buildWindowsSecurityReport(findings, remediationPlan);
			const saved =
				save === true
					? await saveWindowsAssessmentRecord({
							playbookId: playbook ?? "unknown",
							findings,
						})
					: null;
			return {
				success: true,
				findings,
				remediationPlan,
				report,
				history: saved,
			};
		}

		if (!playbook) {
			return {
				success: false,
				error: "Provide a playbook id when action is get.",
			};
		}

		const selected = getWindowsSecurityPlaybook(playbook as WindowsSecurityPlaybookId);
		return {
			success: true,
			playbook: {
				id: selected.id,
				title: selected.title,
				description: selected.description,
				riskLevel: selected.riskLevel,
				checks: selected.checks,
				command: buildWindowsSecurityPlaybookCommand(selected.id),
			},
		};
	},
});
