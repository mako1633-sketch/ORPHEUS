import { describe, expect, it } from "bun:test";
import { buildDaemonSystemPrompt } from "../src/ai/system-prompt";

describe("system prompt", () => {
	it("includes coding-agent behavior in text mode", () => {
		const prompt = buildDaemonSystemPrompt({
			mode: "text",
			currentDate: new Date("2026-05-03T12:00:00"),
		});

		expect(prompt).toContain("# Coding Agent Behavior");
		expect(prompt).toContain("Inspect the project before giving implementation advice");
		expect(prompt).toContain("Use the projectContext tool as the first pass");
		expect(prompt).toContain("executiveAssistant");
		expect(prompt).toContain("JARVIS-style executive workbench");
		expect(prompt).toContain("long-term task stack");
		expect(prompt).toContain("stackPush, stackList, stackUpdate, and stackPop");
		expect(prompt).toContain("todoManager for the current turn's working checklist");
		expect(prompt).toContain("codingWorkbench");
		expect(prompt).toContain("persistent coding task ledger");
		expect(prompt).toContain("Form a concrete edit-and-validation loop");
		expect(prompt).toContain("After code changes, run the smallest meaningful validation first");
		expect(prompt).toContain("Treat every coding task as a closed loop");
		expect(prompt).toContain("Before finishing meaningful code work, run an adversarial self-review");
		expect(prompt).toContain("empty inputs, stale state, auth/permission boundaries");
		expect(prompt).toContain("Do not claim a file write, command, migration, or fix succeeded");
		expect(prompt).toContain("Keep the self-critique mostly silent");
		expect(prompt).toContain("Use selfReview before finishing meaningful code work");
		expect(prompt).toContain("Use completionGate before claiming a non-trivial coding task is done");
		expect(prompt).toContain("Use projectDoctor for one-command repo setup/readiness checks");
		expect(prompt).toContain("Use githubPublishPlan before initializing");
		expect(prompt).toContain("Use failureRecovery after failed checks or service hiccups");
		expect(prompt).toContain("strategy, pivot plan, safe next action, and retry policy");
		expect(prompt).toContain("records a structured retrospective and a compact long-term lesson");
	});

	it("adds stricter GitHub Copilot/Codex execution guidance for coding mode", () => {
		const prompt = buildDaemonSystemPrompt({
			mode: "text",
			currentDate: new Date("2026-05-03T12:00:00"),
			copilotCodingMode: true,
		});

		expect(prompt).toContain("# GitHub Copilot/Codex Coding Mode");
		expect(prompt).toContain("Treat this as an execution environment, not a chat-only coding model");
		expect(prompt).toContain("Do not solve coding requests from memory alone");
		expect(prompt).toContain(
			"Begin by establishing repo state with projectContext or codingWorkbench repoStatus"
		);
		expect(prompt).toContain("After a failed check, call codingWorkbench failureRecovery");
		expect(prompt).toContain("pivot on deterministic failures before rerunning");
		expect(prompt).toContain("write durable lessons to long-term memory");
		expect(prompt).toContain("Never imply GitHub Copilot/Codex CLI performed a change");
	});

	it("does not add Copilot/Codex execution guidance outside coding mode", () => {
		const prompt = buildDaemonSystemPrompt({
			mode: "text",
			currentDate: new Date("2026-05-03T12:00:00"),
		});

		expect(prompt).not.toContain("# GitHub Copilot/Codex Coding Mode");
	});

	it("includes concise coding guidance in voice mode", () => {
		const prompt = buildDaemonSystemPrompt({
			mode: "voice",
			currentDate: new Date("2026-05-03T12:00:00"),
		});

		expect(prompt).toContain("CODING HELP:");
		expect(prompt).toContain("inspect files and project scripts before recommending changes");
		expect(prompt).toContain("Run targeted validation after changes when practical");
		expect(prompt).toContain("separate evidence from inference");
		expect(prompt).toContain("compact status, project doctor, context budget, and failure recovery");
	});

	it("includes Windows security-first behavior in text mode", () => {
		const prompt = buildDaemonSystemPrompt({
			mode: "text",
			currentDate: new Date("2026-05-03T12:00:00"),
		});

		expect(prompt).toContain("# Windows Security Posture");
		expect(prompt).toContain("Default to defensive administration");
		expect(prompt).toContain("Never request or reveal secrets");
		expect(prompt).toContain("Do not disable Defender, firewall, SmartScreen, UAC");
	});

	it("keeps ORPHEUS conversational for normal questions", () => {
		const prompt = buildDaemonSystemPrompt({
			mode: "text",
			currentDate: new Date("2026-05-03T12:00:00"),
		});

		expect(prompt).toContain("Be conversational: answer questions directly");
		expect(prompt).toContain("ordinary questions deserve ordinary conversational answers");
		expect(prompt).toContain("answer the question first");
		expect(prompt).toContain("Use tools only when the user asks for an action");
	});

	it("requires scoping broad Windows vulnerability assessments", () => {
		const prompt = buildDaemonSystemPrompt({
			mode: "text",
			currentDate: new Date("2026-05-03T12:00:00"),
		});

		expect(prompt).toContain("Vulnerability assessment protocol");
		expect(prompt).toContain('For broad requests like "Can you do a vulnerability assessment?"');
		expect(prompt).toContain("ask one scoping question before running assessment commands");
		expect(prompt).toContain("local Windows posture, specific software/app, or network/host scope");
	});

	it("treats this Windows device as a clear local assessment scope", () => {
		const prompt = buildDaemonSystemPrompt({
			mode: "text",
			currentDate: new Date("2026-05-03T12:00:00"),
		});

		expect(prompt).toContain('If the user explicitly says "this Windows device"');
		expect(prompt).toContain("the scope is already clear");
		expect(prompt).toContain("Do not ask another scope question");
	});

	it("requires security-sensitive report files to be opt-in", () => {
		const prompt = buildDaemonSystemPrompt({
			mode: "text",
			currentDate: new Date("2026-05-03T12:00:00"),
		});

		expect(prompt).toContain("do NOT write files automatically");
		expect(prompt).toContain(
			"Summarize in chat first and write a file only if the user explicitly asks or approves"
		);
		expect(prompt).toContain(
			"Do not write security reports or capability files unless the user explicitly asks or approves"
		);
	});

	it("prevents fake tool-call narration in user-facing answers", () => {
		const prompt = buildDaemonSystemPrompt({
			mode: "text",
			currentDate: new Date("2026-05-03T12:00:00"),
		});

		expect(prompt).toContain("# Tool Behavior");
		expect(prompt).toContain("Do not print fake tool calls, function-call JSON, or tool parameter JSON");
		expect(prompt).toContain("Do not narrate internal tool selection");
		expect(prompt).toContain('Do not tell the user "the provided functions do not include"');
		expect(prompt).toContain(
			"Either ask the needed scoping question, call the appropriate tool, or answer normally"
		);
	});

	it("identifies runBash as the Windows posture assessment tool", () => {
		const prompt = buildDaemonSystemPrompt({
			mode: "text",
			currentDate: new Date("2026-05-03T12:00:00"),
		});

		expect(prompt).toContain("this is the correct tool for system information gathering");
		expect(prompt).toContain("Use this before runBash/runShell for local Windows security posture");
		expect(prompt).toContain("Prefer quickPosture for broad local Windows posture checks");
		expect(prompt).toContain("fullReadOnlyAssessment");
		expect(prompt).toContain("action=get must happen before action=parse");
		expect(prompt).toContain("Never call action=parse with empty output");
		expect(prompt).toContain("runBash/runShell can perform safe local Windows posture assessment");
		expect(prompt).toContain("approved read-only PowerShell commands");
	});

	it("includes ORPHEUS doctor/status guidance", () => {
		const prompt = buildDaemonSystemPrompt({
			mode: "text",
			currentDate: new Date("2026-05-03T12:00:00"),
		});

		expect(prompt).toContain("daemonStatus");
		expect(prompt).toContain("ORPHEUS doctor/status check");
		expect(prompt).toContain("provider keys, web search, Signal, shell");
		expect(prompt).toContain("dashboard: compact green/yellow/red capability dashboard");
		expect(prompt).toContain("launchBriefing");
		expect(prompt).toContain("without revealing secret values");
	});

	it("includes Windows hardening baseline guidance", () => {
		const prompt = buildDaemonSystemPrompt({
			mode: "text",
			currentDate: new Date("2026-05-03T12:00:00"),
		});

		expect(prompt).toContain("windowsHardening");
		expect(prompt).toContain("named baselines");
		expect(prompt).toContain("rollback-aware hardening plans");
		expect(prompt).toContain("Run checkCommand and policyCommand before any remediation");
		expect(prompt).toContain("Group Policy, MDM, Defender for Endpoint");
		expect(prompt).toContain("quick wins, needs admin, needs reboot");
	});

	it("requires real built-in PowerShell commands for Windows assessment evidence", () => {
		const prompt = buildDaemonSystemPrompt({
			mode: "text",
			currentDate: new Date("2026-05-03T12:00:00"),
		});

		expect(prompt).toContain("Use real built-in commands for Windows assessment");
		expect(prompt).toContain("Get-MpComputerStatus");
		expect(prompt).toContain("Get-NetFirewallProfile");
		expect(prompt).toContain("Do not invent cmdlets such as Get-WindowsVulnerabilityReport");
		expect(prompt).toContain("Do not invent high-level scanner cmdlets");
	});

	it("prevents raw grounding recovery examples in user-facing answers", () => {
		const prompt = buildDaemonSystemPrompt({
			mode: "text",
			currentDate: new Date("2026-05-03T12:00:00"),
		});

		expect(prompt).toContain("If grounding validation fails");
		expect(prompt).toContain("do not show corrected groundingManager JSON");
		expect(prompt).toContain("do not teach the user the tool schema or print a corrected tool call");
		expect(prompt).toContain("Briefly say the web-sourced claim could not be grounded");
	});

	it("includes short follow-up continuity guidance", () => {
		const prompt = buildDaemonSystemPrompt({
			mode: "text",
			currentDate: new Date("2026-05-03T12:00:00"),
		});

		expect(prompt).toContain("# Conversation Continuity");
		expect(prompt).toContain('Treat short replies such as "yes", "yes please"');
		expect(prompt).toContain("continue that action unless it requires tool approval");
		expect(prompt).toContain("<conversation-continuity>");
	});

	it("tells ORPHEUS not to retry invalid web search", () => {
		const prompt = buildDaemonSystemPrompt({
			mode: "text",
			currentDate: new Date("2026-05-03T12:00:00"),
		});

		expect(prompt).toContain("If webSearch or fetchUrls reports that EXA_API_KEY is invalid or unavailable");
		expect(prompt).toContain("do not retry web search in the same answer");
		expect(prompt).toContain("web search is unavailable until the key is updated");
	});

	it("uses defensive Windows security capability wording", () => {
		const prompt = buildDaemonSystemPrompt({
			mode: "text",
			currentDate: new Date("2026-05-03T12:00:00"),
		});

		expect(prompt).toContain("defensive assessment, hardening, patch review, configuration audit");
		expect(prompt).toContain("Do not present broad penetration testing as a default capability");
		expect(prompt).toContain("only as authorized, scoped, defensive validation");
	});

	it("includes concise Windows security guidance in voice mode", () => {
		const prompt = buildDaemonSystemPrompt({
			mode: "voice",
			currentDate: new Date("2026-05-03T12:00:00"),
		});

		expect(prompt).toContain("WINDOWS SECURITY:");
		expect(prompt).toContain("Use read-only PowerShell inspection first");
		expect(prompt).toContain("Do not help with credential theft");
		expect(prompt).toContain(
			"ask whether the scope is local Windows posture, a specific app, or network/host scope"
		);
		expect(prompt).toContain("Do not print fake function-call JSON");
	});
});
