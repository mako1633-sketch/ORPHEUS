import { buildWindowsSecurityPlaybookCommand } from "../security/windows-security-playbooks";

const FULL_ASSESSMENT_PATTERN =
	/\b(full|complete|comprehensive)\b[\s\S]{0,80}\b(read-only\s+)?windows\b[\s\S]{0,80}\b(security|vulnerability|posture)\b[\s\S]{0,80}\b(assessment|audit|review)\b/i;

const LOCAL_ASSESSMENT_PATTERN =
	/\b(this device|this machine|current security posture|local windows|windows device)\b/i;

function shouldInjectWindowsAssessmentContext(userText: string): boolean {
	const normalized = userText.trim();
	if (!normalized) return false;
	if (normalized.includes("<windows-assessment-directive>")) return false;

	return (
		FULL_ASSESSMENT_PATTERN.test(normalized) ||
		(LOCAL_ASSESSMENT_PATTERN.test(normalized) && /\b(full|complete|comprehensive)\b/i.test(normalized))
	);
}

export function buildUserMessageWithWindowsAssessmentContext(
	userText: string,
	platform = process.platform
): string {
	if (platform !== "win32") return userText;
	if (!shouldInjectWindowsAssessmentContext(userText)) return userText;

	const command = buildWindowsSecurityPlaybookCommand("fullReadOnlyAssessment");

	return `<windows-assessment-directive>
The user is asking for a full local Windows security assessment.

Required sequence:
1. Use the windowsSecurity playbook flow for playbook "fullReadOnlyAssessment".
2. Ask for approval to run the read-only PowerShell command bundle below with runBash/runShell.
3. Only after command output exists, call windowsSecurity with action "parse" using that real output.
4. Do not call windowsSecurity action "parse" with empty output.
5. Do not print tool parameter JSON or raw function-call JSON to the user.
6. Do not save assessment history unless the user explicitly asks for a saved record.

Approved read-only command bundle:
${command}
</windows-assessment-directive>

${userText}`;
}
