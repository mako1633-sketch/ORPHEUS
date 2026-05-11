export type AssessmentSeverity = "info" | "low" | "medium" | "high";

export interface AssessmentFinding {
	id: string;
	title: string;
	severity: AssessmentSeverity;
	evidence: string;
	risk: string;
	remediation: string;
	confidence: "low" | "medium" | "high";
}

const SECTION_PATTERN = /^###\s+(.+)$/gm;

function sectionize(output: string): Map<string, string> {
	const sections = new Map<string, string>();
	const matches = [...output.matchAll(SECTION_PATTERN)];
	for (let i = 0; i < matches.length; i += 1) {
		const match = matches[i];
		if (!match?.index || !match[1]) continue;
		const next = matches[i + 1]?.index ?? output.length;
		const bodyStart = match.index + match[0].length;
		sections.set(match[1].trim(), output.slice(bodyStart, next).trim());
	}
	return sections;
}

function has(section: string, pattern: RegExp): boolean {
	return pattern.test(section);
}

function makeFinding(
	id: string,
	title: string,
	severity: AssessmentSeverity,
	evidence: string,
	risk: string,
	remediation: string,
	confidence: AssessmentFinding["confidence"] = "medium"
): AssessmentFinding {
	return { id, title, severity, evidence: evidence.trim(), risk, remediation, confidence };
}

export function parseWindowsAssessmentOutput(output: string): AssessmentFinding[] {
	const sections = sectionize(output);
	const findings: AssessmentFinding[] = [];

	const defender = sections.get("Microsoft Defender status") ?? "";
	if (defender) {
		if (has(defender, /AntivirusEnabled\s*[:=]?\s*False/i)) {
			findings.push(
				makeFinding(
					"defender-disabled",
					"Microsoft Defender antivirus appears disabled",
					"high",
					defender,
					"Disabled antivirus materially increases exposure to malware and unsafe downloads.",
					"Re-enable Microsoft Defender or confirm another managed antivirus is installed and healthy.",
					"high"
				)
			);
		}
		if (has(defender, /RealTimeProtectionEnabled\s*[:=]?\s*False/i)) {
			findings.push(
				makeFinding(
					"defender-realtime-disabled",
					"Defender real-time protection appears disabled",
					"high",
					defender,
					"Without real-time scanning, malicious files may execute before detection.",
					"Turn real-time protection back on after confirming no policy-managed exception applies.",
					"high"
				)
			);
		}
		if (has(defender, /AntivirusSignatureLastUpdated\s*[:=]?\s*(?!\s*$)/i)) {
			findings.push(
				makeFinding(
					"defender-signature-observed",
					"Defender signature timestamp collected",
					"info",
					defender,
					"Signature recency determines how well Defender recognizes current threats.",
					"Compare the timestamp against current date and update signatures if stale.",
					"medium"
				)
			);
		}
	}

	const firewall = sections.get("Firewall profile state") ?? "";
	if (firewall) {
		if (has(firewall, /Enabled\s*[:=]?\s*False/i)) {
			findings.push(
				makeFinding(
					"firewall-profile-disabled",
					"One or more Windows Firewall profiles appear disabled",
					"high",
					firewall,
					"Disabled firewall profiles can expose local services to untrusted networks.",
					"Enable all applicable firewall profiles unless a managed security policy intentionally controls them.",
					"high"
				)
			);
		}
		if (has(firewall, /DefaultInboundAction\s*[:=]?\s*Allow/i)) {
			findings.push(
				makeFinding(
					"firewall-inbound-allow",
					"Default inbound firewall action allows traffic",
					"medium",
					firewall,
					"Allow-by-default inbound policy increases the chance that exposed services are reachable.",
					"Use block-by-default inbound policy and explicit allow rules for required services.",
					"high"
				)
			);
		}
	}

	const admins = sections.get("Local administrators") ?? "";
	if (admins) {
		const nonEmptyLines = admins.split(/\r?\n/).filter((line) => line.trim().length > 0);
		if (nonEmptyLines.length > 3) {
			findings.push(
				makeFinding(
					"admin-membership-review",
					"Local administrator membership needs review",
					"medium",
					admins,
					"Extra local admins increase blast radius if one account is compromised.",
					"Review each administrator, remove stale entries, and prefer standard accounts for daily work.",
					"medium"
				)
			);
		}
	}

	const listening = sections.get("Listening TCP ports") ?? "";
	if (listening) {
		const portLines = listening.split(/\r?\n/).filter((line) => /\b\d{1,5}\b/.test(line));
		if (portLines.length > 0) {
			findings.push(
				makeFinding(
					"listening-ports-review",
					"Listening TCP services observed",
					"low",
					listening,
					"Listening services can be reachable locally or over the network depending on bind address and firewall policy.",
					"Verify each listening port is expected, patched, and restricted by firewall rules where possible.",
					"medium"
				)
			);
		}
	}

	if (findings.length === 0 && output.trim().length > 0) {
		findings.push(
			makeFinding(
				"assessment-output-collected",
				"Assessment evidence collected",
				"info",
				output.slice(0, 2000),
				"No high-confidence issue was detected by the lightweight parser alone.",
				"Review the collected evidence and compare against your expected baseline.",
				"low"
			)
		);
	}

	return findings;
}
