import { describe, expect, it } from "bun:test";
import { buildUserMessageWithWindowsAssessmentContext } from "../src/ai/windows-assessment-context";

describe("Windows assessment context", () => {
	it("injects the full assessment playbook sequence for clear local assessment prompts", () => {
		const result = buildUserMessageWithWindowsAssessmentContext(
			"Run a full read-only Windows security assessment on this device and structure the findings.",
			"win32"
		);

		expect(result).toContain("<windows-assessment-directive>");
		expect(result).toContain('playbook "fullReadOnlyAssessment"');
		expect(result).toContain("Ask for approval to run the read-only PowerShell command bundle");
		expect(result).toContain('Only after command output exists, call windowsSecurity with action "parse"');
		expect(result).toContain('Do not call windowsSecurity action "parse" with empty output');
		expect(result).toContain("Get-ComputerInfo");
	});

	it("leaves unrelated prompts unchanged", () => {
		const prompt = "Explain how Windows Defender works.";
		expect(buildUserMessageWithWindowsAssessmentContext(prompt, "win32")).toBe(prompt);
	});

	it("does not inject Windows assessment commands on macOS", () => {
		const prompt = "Run a full read-only Windows security assessment on this device.";
		expect(buildUserMessageWithWindowsAssessmentContext(prompt, "darwin")).toBe(prompt);
	});
});
