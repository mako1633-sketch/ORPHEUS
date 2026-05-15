import {
	type HardeningStage,
	type WindowsHardeningProfileId,
	type WindowsHardeningRule,
	getWindowsHardeningRulesForProfile,
} from "./windows-hardening-baselines";

export interface HardeningPlanItem {
	rule: WindowsHardeningRule;
	stage: HardeningStage[];
	checkCommand: string;
	policyCheckCommand: string;
	remediationCommand: string;
	rollbackCommand: string;
	requiresApproval: true;
	notes: string[];
}

export interface HardeningPlan {
	profileId: WindowsHardeningProfileId;
	items: HardeningPlanItem[];
	summary: Record<HardeningStage, number>;
}

function summarize(items: HardeningPlanItem[]): Record<HardeningStage, number> {
	const result: Record<HardeningStage, number> = {
		"quick-win": 0,
		"needs-admin": 0,
		"needs-reboot": 0,
		"usability-tradeoff": 0,
		"managed-policy": 0,
	};
	for (const item of items) {
		for (const stage of item.stage) {
			result[stage] += 1;
		}
	}
	return result;
}

export function buildWindowsHardeningPlan(profileId: WindowsHardeningProfileId): HardeningPlan {
	const items = getWindowsHardeningRulesForProfile(profileId).map(
		(rule): HardeningPlanItem => ({
			rule,
			stage: rule.stages,
			checkCommand: rule.checkCommand,
			policyCheckCommand: rule.policyCheckCommand,
			remediationCommand: rule.remediationCommand,
			rollbackCommand: rule.rollbackCommand,
			requiresApproval: true,
			notes: [
				"Run checkCommand first and compare with expectedState.",
				"Run policyCheckCommand before remediation; if policy-managed, do not overwrite local settings.",
				"Capture current output before remediation so rollback can restore intent.",
			],
		})
	);
	return {
		profileId,
		items,
		summary: summarize(items),
	};
}

export function buildHardeningCheckCommand(profileId: WindowsHardeningProfileId): string {
	return getWindowsHardeningRulesForProfile(profileId)
		.map((rule) => {
			const title = rule.title.replace(/'/g, "''");
			return `Write-Output ''; Write-Output '### ${title}'; ${rule.checkCommand}`;
		})
		.join("; ");
}

export function buildPolicyCheckCommand(profileId: WindowsHardeningProfileId): string {
	return getWindowsHardeningRulesForProfile(profileId)
		.map((rule) => {
			const title = rule.title.replace(/'/g, "''");
			return `Write-Output ''; Write-Output '### Policy: ${title}'; ${rule.policyCheckCommand}`;
		})
		.join("; ");
}
