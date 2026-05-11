import type { AssessmentFinding } from "./windows-assessment-parser";
import type { WindowsSecurityReport } from "./windows-security-report";

export type SecurityControlFramework = "CIS" | "NIST CSF" | "Cyber Insurance";
export type SecurityControlStatus = "confirmed" | "partial" | "unknown" | "failed";

export interface SecurityControlMapping {
	id: string;
	framework: SecurityControlFramework;
	title: string;
	status: SecurityControlStatus;
	evidence: string;
	gaps: string[];
	relatedFindingIds: string[];
}

function hasFinding(findings: AssessmentFinding[], pattern: RegExp): boolean {
	return findings.some((finding) => pattern.test(`${finding.id} ${finding.title}`));
}

function hasActionableFinding(findings: AssessmentFinding[], pattern: RegExp): boolean {
	return findings.some(
		(finding) => finding.severity !== "info" && pattern.test(`${finding.id} ${finding.title}`)
	);
}

function related(findings: AssessmentFinding[], pattern: RegExp): string[] {
	return findings
		.filter((finding) => pattern.test(`${finding.id} ${finding.title}`))
		.map((finding) => finding.id)
		.sort();
}

function localStatus(
	findings: AssessmentFinding[],
	pattern: RegExp,
	collectedEvidence: string,
	noEvidenceGap: string
): Pick<SecurityControlMapping, "status" | "evidence" | "gaps" | "relatedFindingIds"> {
	const ids = related(findings, pattern);
	if (hasActionableFinding(findings, pattern)) {
		return {
			status: "failed",
			evidence: collectedEvidence,
			gaps: ["Actionable local finding requires remediation or accepted-risk decision."],
			relatedFindingIds: ids,
		};
	}
	if (hasFinding(findings, pattern)) {
		return {
			status: "confirmed",
			evidence: collectedEvidence,
			gaps: [],
			relatedFindingIds: ids,
		};
	}
	return {
		status: "unknown",
		evidence: "No parser signal was collected for this control.",
		gaps: [noEvidenceGap],
		relatedFindingIds: [],
	};
}

export function buildSecurityControlMappings(
	findings: AssessmentFinding[],
	report: WindowsSecurityReport
): SecurityControlMapping[] {
	const defender = localStatus(
		findings,
		/defender|antivirus|realtime|signature/i,
		"Local Defender evidence was collected from the Windows assessment.",
		"Confirm endpoint protection or EDR is deployed and healthy."
	);
	const firewall = localStatus(
		findings,
		/firewall|inbound/i,
		"Windows Firewall profile evidence was collected from the Windows assessment.",
		"Confirm firewall profiles and inbound defaults."
	);
	const admins = localStatus(
		findings,
		/admin|account|privilege|membership/i,
		"Local administrator membership evidence was collected from the Windows assessment.",
		"Review privileged access and stale standing administrator rights."
	);
	const patches = localStatus(
		findings,
		/update|hotfix|patch|signature/i,
		"Patch and/or security signature evidence was collected from the Windows assessment.",
		"Confirm operating system and third-party patch cadence."
	);
	const backups = report.cyberReadinessControls.find((control) => control.id === "backups");
	const mfa = report.cyberReadinessControls.find((control) => control.id === "mfa");
	const ir = report.cyberReadinessControls.find((control) => control.id === "incident-response");

	return [
		{
			id: "cis-10-malware-defenses",
			framework: "CIS",
			title: "Malware defenses",
			...defender,
		},
		{
			id: "cis-4-secure-configuration",
			framework: "CIS",
			title: "Secure configuration of enterprise assets",
			...firewall,
		},
		{
			id: "cis-5-account-management",
			framework: "CIS",
			title: "Account management and least privilege",
			...admins,
		},
		{
			id: "cis-7-vulnerability-management",
			framework: "CIS",
			title: "Continuous vulnerability and patch management",
			...patches,
		},
		{
			id: "nist-pr-ip-maintenance",
			framework: "NIST CSF",
			title: "Protective technology and maintenance",
			...patches,
		},
		{
			id: "nist-pr-ac-access-control",
			framework: "NIST CSF",
			title: "Identity management and access control",
			status: admins.status === "confirmed" && mfa?.status !== "questionnaire" ? "confirmed" : "partial",
			evidence: "Local administrator evidence is paired with owner-confirmed MFA questions.",
			gaps: [
				...(admins.gaps ?? []),
				...(mfa?.status === "questionnaire" ? ["Owner must confirm MFA coverage."] : []),
			],
			relatedFindingIds: admins.relatedFindingIds,
		},
		{
			id: "insurance-mfa",
			framework: "Cyber Insurance",
			title: "MFA for email, remote access, and admin accounts",
			status: "unknown",
			evidence: mfa?.note ?? "MFA cannot be verified from local Windows evidence.",
			gaps: ["Owner attestation or identity-provider evidence required."],
			relatedFindingIds: [],
		},
		{
			id: "insurance-backups",
			framework: "Cyber Insurance",
			title: "Encrypted, segregated backups and restore tests",
			status: "unknown",
			evidence: backups?.note ?? "Backup architecture cannot be verified from local Windows evidence.",
			gaps: ["Owner attestation, backup policy, or restore-test evidence required."],
			relatedFindingIds: [],
		},
		{
			id: "insurance-incident-response",
			framework: "Cyber Insurance",
			title: "Incident response and recovery plan",
			status: "unknown",
			evidence: ir?.note ?? "Incident response process cannot be verified from local Windows evidence.",
			gaps: ["Owner attestation or written plan required."],
			relatedFindingIds: [],
		},
	];
}

export function summarizeControlMappings(
	mappings: SecurityControlMapping[]
): Record<SecurityControlStatus, number> {
	return mappings.reduce(
		(summary, mapping) => {
			summary[mapping.status] += 1;
			return summary;
		},
		{ confirmed: 0, partial: 0, unknown: 0, failed: 0 } satisfies Record<SecurityControlStatus, number>
	);
}
