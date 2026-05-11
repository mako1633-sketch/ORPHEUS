import { describe, expect, it } from "bun:test";
import { parseWindowsAssessmentOutput } from "../src/security/windows-assessment-parser";
import { buildWindowsRemediationPlan } from "../src/security/windows-remediation";

describe("Windows assessment parser", () => {
	it("turns playbook output into structured findings", () => {
		const findings = parseWindowsAssessmentOutput(`
### Microsoft Defender status
AntivirusEnabled : False
RealTimeProtectionEnabled : False

### Firewall profile state
Name : Public
Enabled : False
DefaultInboundAction : Allow
`);

		expect(findings.map((finding) => finding.id)).toContain("defender-disabled");
		expect(findings.map((finding) => finding.id)).toContain("defender-realtime-disabled");
		expect(findings.map((finding) => finding.id)).toContain("firewall-profile-disabled");
		expect(findings.every((finding) => finding.evidence.length > 0)).toBe(true);
	});

	it("builds remediation steps that always require approval", () => {
		const findings = parseWindowsAssessmentOutput(`
### Firewall profile state
Enabled : False
`);
		const plan = buildWindowsRemediationPlan(findings);

		expect(plan.length).toBeGreaterThan(0);
		expect(plan.every((step) => step.approvalRequired)).toBe(true);
		expect(plan[0]?.rollback.length).toBeGreaterThan(0);
	});
});
