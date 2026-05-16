import { describe, expect, it } from "bun:test";
import {
	buildUserMessageWithFollowUpContext,
	isShortContextualReply,
	resolveNumberedFollowUpPrompt,
	resolveNumberedFollowUpSelection,
} from "../src/ai/follow-up-context";
import type { ModelMessage } from "../src/types";

const history: ModelMessage[] = [
	{ role: "user", content: "Does that look secure?" },
	{
		role: "assistant",
		content:
			"I can investigate further and provide more information on what you can do to tighten security.",
	},
];

describe("follow-up context", () => {
	it("detects short contextual replies", () => {
		expect(isShortContextualReply("Yes please")).toBe(true);
		expect(isShortContextualReply("option 2")).toBe(true);
		expect(isShortContextualReply("1 and 2")).toBe(true);
		expect(isShortContextualReply("both")).toBe(true);
		expect(isShortContextualReply("Please proceed with these tasks.")).toBe(true);
		expect(isShortContextualReply("Run those")).toBe(true);
		expect(isShortContextualReply("Please write a detailed audit plan for my Windows host")).toBe(
			false
		);
	});

	it("wraps yes replies with previous assistant context", () => {
		const result = buildUserMessageWithFollowUpContext("Yes please", history);

		expect(result).toContain("<conversation-continuity>");
		expect(result).toContain("<previous-assistant-message>");
		expect(result).toContain("I can investigate further");
		expect(result).toContain("<user-reply>");
		expect(result).toContain("Yes please");
	});

	it("wraps short negative replies with previous assistant context", () => {
		const result = buildUserMessageWithFollowUpContext("No", history);

		expect(result).toContain("<conversation-continuity>");
		expect(result).toContain("<user-reply>");
		expect(result).toContain("No");
	});

	it("wraps task-reference replies with previous assistant context", () => {
		const result = buildUserMessageWithFollowUpContext("Please proceed with these tasks.", history);

		expect(result).toContain("<conversation-continuity>");
		expect(result).toContain("I can investigate further");
		expect(result).toContain("Please proceed with these tasks.");
	});

	it("resolves a single number against suggested follow-up prompts", () => {
		const result = resolveNumberedFollowUpSelection("1", [
			{
				role: "assistant",
				content:
					"## Suggested Follow-up Prompts\n" +
					"1. Explain for owner: Explain this security report for a non-technical business owner.\n" +
					"2. Client email: Generate a client-ready remediation email from this report.",
			},
		]);

		expect(result).toContain("selected numbered option 1");
		expect(result).toContain("<selected-prompt>");
		expect(result).toContain("Explain this security report for a non-technical business owner.");
		expect(result).not.toContain("<user-reply>");
	});

	it("returns the plain selected prompt for routing", () => {
		const result = resolveNumberedFollowUpPrompt("1", [
			{
				role: "assistant",
				content:
					"## Suggested Follow-up Prompts\n" +
					"1. Follow-up scan: After I make changes, run a follow-up Security Snapshot and compare before/after.",
			},
		]);

		expect(result).toBe(
			"After I make changes, run a follow-up Security Snapshot and compare before/after."
		);
	});

	it("uses selected prompt context instead of passing a bare number to the model", () => {
		const result = buildUserMessageWithFollowUpContext("2", [
			{
				role: "assistant",
				content:
					"## Suggested Follow-up Prompts\n" +
					"1. Explain for owner: Explain this security report for a non-technical business owner.\n" +
					"2. Client email: Generate a client-ready remediation email from this report.",
			},
		]);

		expect(result).toContain("Generate a client-ready remediation email from this report.");
		expect(result).toContain('not as the literal reply "2"');
	});

	it("resolves multiple suggested follow-up prompt selections", () => {
		const result = resolveNumberedFollowUpPrompt("1 and 2", [
			{
				role: "assistant",
				content:
					"## Suggested Follow-up Prompts\n" +
					"1. Explain for owner: Explain this security report for a non-technical business owner.\n" +
					"2. Client email: Generate a client-ready remediation email from this report.",
			},
		]);

		expect(result).toContain("Explain this security report for a non-technical business owner.");
		expect(result).toContain("Generate a client-ready remediation email from this report.");
	});

	it("does not resolve numbers from remediation plans as suggested prompts", () => {
		const result = resolveNumberedFollowUpPrompt("1", [
			{
				role: "assistant",
				content:
					"**Remediation Plan**\n" +
					"1. Local administrator membership needs review: Review each administrator.\n" +
					"2. Listening TCP services observed: Verify each listening port.",
			},
		]);

		expect(result).toBeNull();
	});

	it("leaves normal prompts unchanged", () => {
		const prompt = "Run a local Windows posture assessment for Defender and firewall settings.";
		expect(buildUserMessageWithFollowUpContext(prompt, history)).toBe(prompt);
	});

	it("leaves displayed user text available unchanged to callers", () => {
		const raw = "Yes please";
		const modelText = buildUserMessageWithFollowUpContext(raw, history);

		expect(raw).toBe("Yes please");
		expect(modelText).not.toBe(raw);
	});
});
