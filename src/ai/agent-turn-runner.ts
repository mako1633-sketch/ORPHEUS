import type {
	InteractionMode,
	ModelMessage,
	ReasoningEffort,
	StreamCallbacks,
	TokenUsage,
} from "../types";
import { guardAssistantResponse } from "./assistant-response-guard";
import { generateResponse } from "./daemon-ai";
import { runDirectDaemonDoctor, shouldRunDirectDaemonDoctor } from "./direct-daemon-doctor-runner";
import {
	runDirectImplementationAdvice,
	shouldRunDirectImplementationAdvice,
} from "./direct-implementation-advice-runner";
import {
	runDirectLeastPrivilege,
	shouldRunDirectLeastPrivilege,
} from "./direct-least-privilege-runner";
import {
	runDirectPatchManagement,
	shouldRunDirectPatchManagement,
} from "./direct-patch-management-runner";
import {
	runDirectSecurityEvidencePack,
	shouldRunDirectSecurityEvidencePack,
} from "./direct-security-evidence-pack-runner";
import {
	runDirectSecurityReportFollowUp,
	shouldRunDirectSecurityReportFollowUp,
} from "./direct-security-report-followup-runner";
import {
	runDirectTurnExplanation,
	shouldRunDirectTurnExplanation,
} from "./direct-turn-explanation-runner";
import {
	runDirectWindowsAssessment,
	runDirectWindowsQuickPosture,
	runDirectWindowsSecurityReview,
	runDirectWindowsSecuritySnapshot,
	shouldRunDirectWindowsAssessment,
	shouldRunDirectWindowsQuickPosture,
	shouldRunDirectWindowsSecurityReview,
	shouldRunDirectWindowsSecuritySnapshot,
} from "./direct-windows-assessment-runner";
import {
	runDirectWindowsRemediation,
	shouldRunDirectWindowsRemediation,
} from "./direct-windows-remediation-runner";
import {
	runDirectWindowsScheduledTaskSecurity,
	shouldRunDirectWindowsScheduledTaskSecurity,
} from "./direct-windows-scheduled-task-runner";
import {
	buildUserMessageWithFollowUpContext,
	resolveNumberedFollowUpPrompt,
} from "./follow-up-context";
import { applyRouterDecision, routeTask } from "./model-router";
import { isVisionRequest } from "./vision-reasoning";
import { buildUserMessageWithWindowsAssessmentContext } from "./windows-assessment-context";

function buildVisionContextHint(userText: string): string {
	if (!isVisionRequest(userText)) return "";
	return "\n\n[VISUAL CONTEXT REQUEST] The user may be asking about visible screen or UI state. If current visual evidence is required, use the screenshot tool so normal approval and platform checks apply.";
}

export interface AgentTurnParams {
	userText: string;
	conversationHistory: ModelMessage[];
	interactionMode: InteractionMode;
	reasoningEffort: ReasoningEffort;
	platform?: NodeJS.Platform;
}

export interface AgentTurnResult {
	fullText: string;
	responseMessages: ModelMessage[];
	usage?: TokenUsage;
	finalText?: string;
}

export class AgentTurnRunner {
	private abortController: AbortController | null = null;
	private activeRunId = 0;

	cancel(): void {
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
		this.activeRunId++;
	}

	async run(params: AgentTurnParams, callbacks: StreamCallbacks): Promise<AgentTurnResult | null> {
		this.cancel();
		const runId = this.activeRunId;
		this.abortController = new AbortController();

		const isActive = () => runId === this.activeRunId && this.abortController !== null;
		const isCurrent = () => runId === this.activeRunId;

		let result: AgentTurnResult | null = null;
		let error: Error | null = null;

		const wrapped: StreamCallbacks = {
			onReasoningToken: (token) => {
				if (!isActive()) return;
				callbacks.onReasoningToken?.(token);
			},
			onToolCallStart: (toolName, toolCallId) => {
				if (!isActive()) return;
				callbacks.onToolCallStart?.(toolName, toolCallId);
			},
			onToolCall: (toolName, args, toolCallId) => {
				if (!isActive()) return;
				callbacks.onToolCall?.(toolName, args, toolCallId);
			},
			onToolResult: (toolName, resultValue, toolCallId) => {
				if (!isActive()) return;
				callbacks.onToolResult?.(toolName, resultValue, toolCallId);
			},
			onToolApprovalRequest: (request) => {
				if (!isActive()) return;
				callbacks.onToolApprovalRequest?.(request);
			},
			onAwaitingApprovals: (pendingApprovals, respondToApprovals) => {
				if (!isActive()) return;
				callbacks.onAwaitingApprovals?.(pendingApprovals, respondToApprovals);
			},
			onSubagentToolCall: (toolCallId, toolName, input) => {
				if (!isActive()) return;
				callbacks.onSubagentToolCall?.(toolCallId, toolName, input);
			},
			onSubagentUsage: (usage) => {
				if (!isActive()) return;
				callbacks.onSubagentUsage?.(usage);
			},
			onSubagentToolResult: (toolCallId, toolName, success) => {
				if (!isActive()) return;
				callbacks.onSubagentToolResult?.(toolCallId, toolName, success);
			},
			onSubagentComplete: (toolCallId, success) => {
				if (!isActive()) return;
				callbacks.onSubagentComplete?.(toolCallId, success);
			},
			onToken: (token) => {
				if (!isActive()) return;
				callbacks.onToken?.(token);
			},
			onStepUsage: (usage) => {
				if (!isActive()) return;
				callbacks.onStepUsage?.(usage);
			},
			onMemorySaved: (preview) => {
				if (!isCurrent()) return;
				callbacks.onMemorySaved?.(preview);
			},
			onComplete: (fullText, responseMessages, usage, finalText) => {
				if (!isActive()) return;
				const guarded = guardAssistantResponse({
					fullText,
					finalText,
					responseMessages,
					userText: params.userText,
				});
				result = {
					fullText: guarded.fullText,
					responseMessages: guarded.responseMessages,
					usage,
					finalText: guarded.finalText,
				};
				callbacks.onComplete?.(
					guarded.fullText,
					guarded.responseMessages,
					usage,
					guarded.finalText
				);
			},
			onError: (err) => {
				if (!isActive()) return;
				error = err;
				callbacks.onError?.(err);
			},
		};

		try {
			const routedUserText =
				resolveNumberedFollowUpPrompt(params.userText, params.conversationHistory) ??
				params.userText;
			const platform = params.platform ?? process.platform;
			const windowsDirectActionsAvailable = platform === "win32";

			// Adaptive Model Router: auto-select provider before generating response
			const routerDecision = await routeTask(routedUserText);
			applyRouterDecision(routerDecision);

			const visionContext = buildVisionContextHint(routedUserText);

			if (shouldRunDirectTurnExplanation(routedUserText, params.conversationHistory)) {
				result = await runDirectTurnExplanation(params.conversationHistory, wrapped);
				return result;
			}

			if (shouldRunDirectDaemonDoctor(routedUserText)) {
				result = await runDirectDaemonDoctor(wrapped);
				return result;
			}

			if (shouldRunDirectImplementationAdvice(routedUserText)) {
				result = await runDirectImplementationAdvice(wrapped);
				return result;
			}

			if (shouldRunDirectSecurityReportFollowUp(routedUserText, params.conversationHistory)) {
				result = await runDirectSecurityReportFollowUp(
					routedUserText,
					params.conversationHistory,
					wrapped
				);
				return result;
			}

			if (
				windowsDirectActionsAvailable &&
				shouldRunDirectPatchManagement(routedUserText, params.conversationHistory)
			) {
				result = await runDirectPatchManagement(
					routedUserText,
					params.conversationHistory,
					wrapped
				);
				return result;
			}

			if (windowsDirectActionsAvailable && shouldRunDirectSecurityEvidencePack(routedUserText)) {
				result = await runDirectSecurityEvidencePack(routedUserText, wrapped);
				return result;
			}

			if (
				windowsDirectActionsAvailable &&
				shouldRunDirectWindowsRemediation(routedUserText, params.conversationHistory)
			) {
				result = await runDirectWindowsRemediation(routedUserText, wrapped);
				return result;
			}

			if (
				windowsDirectActionsAvailable &&
				shouldRunDirectLeastPrivilege(routedUserText, params.conversationHistory)
			) {
				result = await runDirectLeastPrivilege(routedUserText, wrapped);
				return result;
			}

			if (
				windowsDirectActionsAvailable &&
				shouldRunDirectWindowsScheduledTaskSecurity(routedUserText)
			) {
				result = await runDirectWindowsScheduledTaskSecurity(routedUserText, wrapped);
				return result;
			}

			if (windowsDirectActionsAvailable && shouldRunDirectWindowsSecuritySnapshot(routedUserText)) {
				result = await runDirectWindowsSecuritySnapshot(routedUserText, wrapped);
				return result;
			}

			if (windowsDirectActionsAvailable && shouldRunDirectWindowsQuickPosture(routedUserText)) {
				result = await runDirectWindowsQuickPosture(routedUserText, wrapped);
				return result;
			}

			if (windowsDirectActionsAvailable && shouldRunDirectWindowsSecurityReview(routedUserText)) {
				result = await runDirectWindowsSecurityReview(routedUserText, wrapped);
				return result;
			}

			if (
				windowsDirectActionsAvailable &&
				shouldRunDirectWindowsAssessment(routedUserText, params.conversationHistory)
			) {
				result = await runDirectWindowsAssessment(routedUserText, wrapped);
				return result;
			}

			const continuityText = buildUserMessageWithFollowUpContext(
				params.userText,
				params.conversationHistory
			);
			const modelUserText =
				buildUserMessageWithWindowsAssessmentContext(continuityText, platform) + visionContext;
			await generateResponse(
				modelUserText,
				wrapped,
				params.conversationHistory,
				params.interactionMode,
				this.abortController.signal,
				params.reasoningEffort,
				params.userText
			);
		} catch (err) {
			const e = err instanceof Error ? err : new Error(String(err));
			error = e;
			wrapped.onError?.(e);
		} finally {
			if (isActive()) {
				this.abortController = null;
			}
		}

		if (error) throw error;
		return result;
	}
}
