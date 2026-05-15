import { describe, expect, it } from "bun:test";
import {
	detectAssistantResponseLeak,
	guardAssistantResponse,
	isAssistantResponseGuardNotice,
	sanitizeAssistantMessagesForModelHistory,
} from "../src/ai/assistant-response-guard";
import { buildWindowsSecurityReport } from "../src/security/windows-security-report";

describe("assistant response guard", () => {
	it("detects leaked tool JSON", () => {
		const leaked = '{"action":"write","todos":{"content":"Apply least privilege","status":"pending"}}';
		expect(detectAssistantResponseLeak(leaked)).toBe("tool-json");
	});

	it("detects prose that exposes tool JSON instead of using the tool", () => {
		const leaked = `To provide an answer to your question, I would use the todoManager tool.

Here is the JSON for this tool:

{
  "action": "list",
  "todos": []
}`;

		expect(detectAssistantResponseLeak(leaked)).toBe("tool-json");
	});

	it("detects common provider function-call protocol leaks", () => {
		const leaks = [
			'{"function_call":{"name":"runBash","arguments":"{\\"command\\":\\"Get-Process\\"}"}}',
			'{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"webSearch","arguments":"{\\"query\\":\\"test\\"}"}}]}',
			'{"toolName":"windowsSecurity","input":{"action":"get","playbook":"quickPosture"}}',
			'<tool-input name="fetchUrls">{"requests":[{"url":"https://example.com"}]}</tool-input>',
			'```json\n{"name":"signal","arguments":{"action":"listAccounts"}}\n```',
		];

		for (const leaked of leaks) {
			expect(detectAssistantResponseLeak(leaked)).toBe("tool-json");
		}
	});

	it("detects leaked internal operating instructions", () => {
		const leaked =
			"Based on the provided instructions and tool capabilities, here is a step-by-step guide to handling the user request.";
		expect(detectAssistantResponseLeak(leaked)).toBe("internal-instructions");
	});

	it("detects leaked tool-planning examples", () => {
		const leaked =
			'Here\'s an example of a tool call using groundingManager:\nsubagent spawn "Explain the report" with tools( groundingManager ).';

		expect(detectAssistantResponseLeak(leaked)).toBe("internal-instructions");
	});

	it("detects compacted tool placeholders from older sessions", () => {
		const leaked = "Now I have the full picture.\n[tool call omitted: writeFile]";

		expect(detectAssistantResponseLeak(leaked)).toBe("internal-instructions");
		expect(sanitizeAssistantMessagesForModelHistory([{ role: "assistant", content: leaked }])).toEqual([]);
	});

	it("detects invented action JSON questionnaires", () => {
		const leaked = `To address this question in the context of the previous conversation, I'll provide a JSON object that includes an action.

{
  "action": "questionnaire",
  "questions": [
    { "id": "1", "question": "Confirm a written incident response plan exists." }
  ]
}`;

		expect(detectAssistantResponseLeak(leaked)).toBe("tool-json");
	});

	it("detects invented Windows security action JSON", () => {
		const leaks = [
			'{"action":"parse","save":true,"playbook":"patchPosture"}',
			'{"action":"info","task":"Provide examples and descriptions of available functions"}',
			'{"action":"append","items":[{"text":"Assuming groundingManager is relevant"}]}',
		];

		for (const leaked of leaks) {
			expect(detectAssistantResponseLeak(leaked)).toBe("tool-json");
		}
	});

	it("replaces leaked responses before they are stored as assistant messages", () => {
		const result = guardAssistantResponse({
			fullText: '{"action":"write","todos":{"content":"Apply least privilege","status":"pending"}}',
			responseMessages: [
				{
					role: "assistant",
					content: '{"action":"write","todos":{"content":"Apply least privilege","status":"pending"}}',
				},
			],
			userText: "Well, that's good.",
		});

		expect(result.replaced).toBe(true);
		expect(result.fullText).toContain("I hit a routing glitch");
		expect(result.fullText).toContain(
			"No Windows settings, files, Signal messages, todos, or security changes"
		);
		expect(result.responseMessages).toEqual([]);
		expect(JSON.stringify(result.responseMessages)).not.toContain('"action":"write"');
	});

	it("recognizes prior guard notices as contaminated history", () => {
		const notice =
			"I hit a routing glitch and blocked an invalid internal action before it reached the system.";

		expect(isAssistantResponseGuardNotice(notice)).toBe(true);
		expect(sanitizeAssistantMessagesForModelHistory([{ role: "assistant", content: notice }]).length).toBe(0);
	});

	it("recovers with a useful answer for immediate implementation prompts", () => {
		const result = guardAssistantResponse({
			fullText: '{"action":"write","todos":{"content":"Implement queue","status":"pending"}}',
			responseMessages: [
				{
					role: "assistant",
					content: '{"action":"write","todos":{"content":"Implement queue","status":"pending"}}',
				},
			],
			userText: "What can you implement right now?",
		});

		expect(result.replaced).toBe(true);
		expect(result.fullText).toContain("Remediation Queue");
		expect(result.fullText).toContain("SLA due dates");
		expect(result.fullText).not.toContain("Your last message was");
	});

	it("replaces mixed prose and leaked tool JSON before it is stored", () => {
		const leaked = `To provide an answer to your question, I would use the todoManager tool.

Here is the JSON for this tool:

{
  "action": "list",
  "todos": []
}`;
		const result = guardAssistantResponse({
			fullText: leaked,
			responseMessages: [{ role: "assistant", content: leaked }],
			userText: "Which ones haven't been used in the last 30 days?",
		});

		expect(result.replaced).toBe(true);
		expect(result.fullText).not.toContain("Here is the JSON");
		expect(result.responseMessages).toEqual([]);
		expect(JSON.stringify(result.responseMessages)).not.toContain('"action"');
		expect(JSON.stringify(result.responseMessages)).not.toContain("todoManager");
	});

	it("preserves real tool-call context while removing leaked assistant text", () => {
		const leaked = `Here is the JSON for this tool:

{ "action": "list", "todos": [] }`;
		const result = guardAssistantResponse({
			fullText: leaked,
			responseMessages: [
				{
					role: "assistant",
					content: [
						{ type: "text", text: leaked },
						{
							type: "tool-call",
							toolCallId: "call_1",
							toolName: "todoManager",
							input: { action: "list" },
						},
					],
				},
				{
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: "call_1",
							toolName: "todoManager",
							output: { type: "json", value: { todos: "No todos." } },
						},
					],
				},
			] as any,
			userText: "Which ones haven't been used in the last 30 days?",
		});

		expect(result.replaced).toBe(true);
		expect(JSON.stringify(result.responseMessages)).not.toContain("Here is the JSON");
		expect(JSON.stringify(result.responseMessages)).toContain("tool-call");
		expect(JSON.stringify(result.responseMessages)).toContain("tool-result");
	});

	it("leaves normal assistant responses unchanged", () => {
		const result = guardAssistantResponse({
			fullText: "Yes. Least privilege is the right direction here.",
			responseMessages: [{ role: "assistant", content: "Yes. Least privilege is the right direction here." }],
			userText: "Does that sound right?",
		});

		expect(result.replaced).toBe(false);
		expect(result.fullText).toContain("Least privilege");
	});

	it("blocks unsupported coding completion claims without evidence", () => {
		const result = guardAssistantResponse({
			fullText: "Done, I fixed it.",
			responseMessages: [{ role: "assistant", content: "Done, I fixed it." }],
			userText: "Please fix the CLI startup bug.",
		});

		expect(result.replaced).toBe(true);
		expect(result.reason).toBe("unsupported-coding-claim");
		expect(result.fullText).toContain("without evidence");
		expect(result.fullText).toContain("verify the change");
	});

	it("allows concise coding completion claims with validation evidence", () => {
		const text = "Fixed. Validation: bun run check passed.";
		const result = guardAssistantResponse({
			fullText: text,
			responseMessages: [{ role: "assistant", content: text }],
			userText: "Please fix the CLI startup bug.",
		});

		expect(result.replaced).toBe(false);
		expect(result.fullText).toBe(text);
	});

	it("allows coding completion claims when tool evidence exists", () => {
		const result = guardAssistantResponse({
			fullText: "Done, I fixed it.",
			responseMessages: [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Done, I fixed it." },
						{
							type: "tool-call",
							toolCallId: "call_1",
							toolName: "codingWorkbench",
							input: { action: "runScript", script: "check" },
						},
					],
				},
			] as any,
			userText: "Please fix the CLI startup bug.",
		});

		expect(result.replaced).toBe(false);
	});

	it("does not flag normal security reports that mention signals", () => {
		const report = buildWindowsSecurityReport([], [], { title: "ORPHEUS Security Snapshot" });

		expect(report.markdown).toContain("No parser signal collected");
		expect(detectAssistantResponseLeak(report.markdown)).toBeNull();
		expect(detectAssistantResponseLeak("Review Defender signals and owner questions.")).toBeNull();
	});

	it("does not flag normal prose that mentions tool-like words", () => {
		const normalMessages = [
			"The next action is to review firewall parameters and owner questions.",
			"Use the runBash output above as evidence, but do not execute changes yet.",
			"The windowsSecurity parser produced no signal for Services.",
			"Signal support is optional; configure it only if you want messaging features.",
			"Suggested follow-up prompts are recommendations, not tool arguments.",
			'This JSON-like data is business data: {"name":"Patch policy","arguments":"owner discussion"}',
		];

		for (const message of normalMessages) {
			expect(detectAssistantResponseLeak(message)).toBeNull();
		}
	});
});
