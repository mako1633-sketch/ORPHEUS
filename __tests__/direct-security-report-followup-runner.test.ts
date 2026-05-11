import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentTurnRunner } from "../src/ai/agent-turn-runner";
import {
	exportSecurityReportMarkdown,
	runDirectSecurityReportFollowUp,
	shouldRunDirectSecurityReportFollowUp,
} from "../src/ai/direct-security-report-followup-runner";
import { resolveNumberedFollowUpPrompt } from "../src/ai/follow-up-context";
import { buildWindowsSecurityReport } from "../src/security/windows-security-report";
import type { ModelMessage, StreamCallbacks } from "../src/types";

function reportHistory(): ModelMessage[] {
	const report = buildWindowsSecurityReport([], [], { title: "ORPHEUS Security Snapshot" });
	return [{ role: "assistant", content: report.markdown }];
}

describe("direct security report follow-up runner", () => {
	it("routes owner explanation follow-ups away from model tool-planning", () => {
		expect(
			shouldRunDirectSecurityReportFollowUp(
				"Explain this security report for a non-technical business owner.",
				reportHistory()
			)
		).toBe(true);
	});

	it("turns a selected numbered report prompt into a direct owner explanation", async () => {
		const report = buildWindowsSecurityReport([], [], { title: "ORPHEUS Security Snapshot" });
		const history: ModelMessage[] = [{ role: "assistant", content: report.markdown }];
		const selected = resolveNumberedFollowUpPrompt("1", history);
		let final = "";
		const callbacks: StreamCallbacks = {
			onComplete: (text) => {
				final = text;
			},
		};

		expect(selected).toBe("Explain this security report for a non-technical business owner.");
		await runDirectSecurityReportFollowUp(selected ?? "", history, callbacks);

		expect(final).toContain("plain-English version");
		expect(final).toContain("Nothing in this explanation changes Windows settings");
		expect(final).not.toContain("groundingManager");
		expect(final).not.toContain("subagent");
		expect(final).not.toContain("Here is the JSON");
	});

	it("generates client email follow-ups directly", async () => {
		let final = "";
		const callbacks: StreamCallbacks = {
			onComplete: (text) => {
				final = text;
			},
		};

		await runDirectSecurityReportFollowUp(
			"Generate a client-ready remediation email from this report.",
			reportHistory(),
			callbacks
		);

		expect(final).toContain("Subject: Windows Security Snapshot Review");
		expect(final).toContain("No changes were made");
		expect(final).not.toContain("tool call");
	});

	it("routes explicit Security Snapshot export follow-ups", () => {
		expect(shouldRunDirectSecurityReportFollowUp("E", reportHistory())).toBe(true);
		expect(shouldRunDirectSecurityReportFollowUp("export report", reportHistory())).toBe(true);
		expect(
			shouldRunDirectSecurityReportFollowUp(
				"Export this Security Snapshot as a client-ready Markdown report.",
				reportHistory()
			)
		).toBe(true);
	});

	it("exports the latest Security Snapshot as a client-ready Markdown file", async () => {
		const outputDir = await mkdtemp(path.join(os.tmpdir(), "orpheus-report-export-"));
		const report = buildWindowsSecurityReport([], [], { title: "ORPHEUS Security Snapshot" });

		const exported = await exportSecurityReportMarkdown(report.markdown, {
			outputDir,
			now: new Date("2026-05-09T12:34:56.000Z"),
		});
		const contents = await readFile(exported.path, "utf8");

		expect(exported.path).toEndWith("orpheus-security-snapshot-20260509T123456Z.md");
		expect(contents).toContain("# Client-Ready Security Snapshot");
		expect(contents).toContain("Prepared by: ORPHEUS");
		expect(contents).toContain("Prepared for: [Client / organization]");
		expect(contents).toContain("# ORPHEUS Security Snapshot");
	});

	it("handles bare numbered report follow-ups through the agent runner without tool planning", async () => {
		let final = "";
		let toolCalls = 0;
		const runner = new AgentTurnRunner();

		await runner.run(
			{
				userText: "1",
				conversationHistory: reportHistory(),
				interactionMode: "text",
				reasoningEffort: "medium",
			},
			{
				onComplete: (text) => {
					final = text;
				},
				onToolCall: () => {
					toolCalls++;
				},
			}
		);

		expect(final).toContain("plain-English version");
		expect(final).not.toContain("groundingManager");
		expect(final).not.toContain("subagent");
		expect(toolCalls).toBe(0);
	});

	it("keeps chained report follow-ups on the deterministic path", async () => {
		let firstFinal = "";
		let secondFinal = "";
		let toolCalls = 0;
		const runner = new AgentTurnRunner();
		const history = reportHistory();

		const firstResult = await runner.run(
			{
				userText: "1",
				conversationHistory: history,
				interactionMode: "text",
				reasoningEffort: "medium",
			},
			{
				onComplete: (text) => {
					firstFinal = text;
				},
				onToolCall: () => {
					toolCalls++;
				},
			}
		);

		expect(firstFinal).toContain("plain-English version");
		expect(firstResult).not.toBeNull();

		const chainedHistory: ModelMessage[] = [
			...history,
			{ role: "user", content: "1" },
			...(firstResult?.responseMessages ?? []),
		];
		expect(
			shouldRunDirectSecurityReportFollowUp(
				"Thank you. Please now run through the insurance checklist.",
				chainedHistory
			)
		).toBe(true);

		await runner.run(
			{
				userText: "Thank you. Please now run through the insurance checklist.",
				conversationHistory: chainedHistory,
				interactionMode: "text",
				reasoningEffort: "medium",
			},
			{
				onComplete: (text) => {
					secondFinal = text;
				},
				onToolCall: () => {
					toolCalls++;
				},
			}
		);

		expect(secondFinal).toContain("Cyber insurance readiness checklist");
		expect(secondFinal).not.toContain("groundingManager");
		expect(secondFinal).not.toContain("subagent");
		expect(toolCalls).toBe(0);
	});

	it("handles numeric selections from a chained insurance checklist without model JSON", async () => {
		let checklist = "";
		let selected = "";
		let toolCalls = 0;
		const runner = new AgentTurnRunner();
		const history = reportHistory();

		const checklistResult = await runner.run(
			{
				userText: "Please run through the insurance checklist.",
				conversationHistory: history,
				interactionMode: "text",
				reasoningEffort: "medium",
			},
			{
				onComplete: (text) => {
					checklist = text;
				},
				onToolCall: () => {
					toolCalls++;
				},
			}
		);

		expect(checklist).toContain("Cyber insurance readiness checklist");
		const chainedHistory: ModelMessage[] = [
			...history,
			{ role: "user", content: "Please run through the insurance checklist." },
			...(checklistResult?.responseMessages ?? []),
		];

		await runner.run(
			{
				userText: "3",
				conversationHistory: chainedHistory,
				interactionMode: "text",
				reasoningEffort: "medium",
			},
			{
				onComplete: (text) => {
					selected = text;
				},
				onToolCall: () => {
					toolCalls++;
				},
			}
		);

		expect(selected).toContain("Item 3:");
		expect(selected).toContain("Plain-English follow-up");
		expect(selected).not.toContain('"action"');
		expect(selected).not.toContain("questionnaire");
		expect(toolCalls).toBe(0);
	});
});
