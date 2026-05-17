import { useMemo } from "react";
import type { ContentBlock, LlmProvider, ModelOption, SessionInfo } from "../types";
import { DaemonState } from "../types";
import { COLORS, STATE_COLOR_HEX, STATUS_TEXT } from "../ui/constants";
import { formatElapsedTime } from "../utils/formatters";
import type { ModelMetadata } from "../utils/model-metadata";

export interface UseAppDisplayStateParams {
	daemonState: DaemonState;
	currentContentBlocks: ContentBlock[];
	currentResponse: string;
	reasoningDisplay: string;
	reasoningQueue: string;
	responseElapsedMs: number;
	hasInteracted: boolean;

	currentModelProvider: LlmProvider;
	currentModelId: string;
	modelMetadata: ModelMetadata | null;
	curatedModels: ModelOption[];
	availableModels: ModelOption[];
	preferencesLoaded: boolean;

	currentSessionId: string | null;
	sessionMenuItems: Array<SessionInfo & { isNew: boolean }>;

	terminalWidth: number;
	terminalHeight: number;
}

export interface UseAppDisplayStateReturn {
	isToolCalling: boolean;
	isReasoning: boolean;
	statusText: string;
	statusColor: string;
	showWorkingSpinner: boolean;
	workingSpinnerLabel: string;
	modelName: string | undefined;
	sessionTitle: string | undefined;
	avatarWidth: number;
	avatarHeight: number;
	frostColor: string;
	isListening: boolean;
	isListeningDim: boolean;
}

const AVATAR_WIDTH_PERCENT = 0.8;
const AVATAR_HEIGHT_PERCENT = 0.8;
const AVATAR_MIN_WIDTH = 80;
const AVATAR_MAX_WIDTH = 500;
const AVATAR_MIN_HEIGHT = 40;
const AVATAR_MAX_HEIGHT = 300;

export function useAppDisplayState(params: UseAppDisplayStateParams): UseAppDisplayStateReturn {
	const {
		daemonState,
		currentContentBlocks,
		currentResponse,
		reasoningDisplay,
		reasoningQueue,
		responseElapsedMs,
		hasInteracted,
		currentModelProvider,
		currentModelId,
		modelMetadata,
		curatedModels,
		availableModels,
		preferencesLoaded,
		currentSessionId,
		sessionMenuItems,
		terminalWidth,
		terminalHeight,
	} = params;

	const isToolCalling = useMemo(() => {
		if (daemonState !== DaemonState.RESPONDING) return false;
		return currentContentBlocks.some((b) => b.type === "tool" && b.call.status === "running");
	}, [daemonState, currentContentBlocks]);

	const isReasoning =
		daemonState === DaemonState.RESPONDING &&
		!isToolCalling &&
		(!currentResponse || !!reasoningDisplay || !!reasoningQueue);

	const statusText = useMemo(() => {
		if (daemonState === DaemonState.RESPONDING) {
			if (isToolCalling) {
				return "ORPHEUS BREACHES I/O... :: ESC cancel :: T trace";
			}
			return isReasoning
				? "ORPHEUS DREAMS IN TRACE... :: ESC cancel :: T trace"
				: "ORPHEUS TRANSMITS... :: ESC cancel :: T trace";
		}
		let baseStatus = STATUS_TEXT[daemonState];
		if (daemonState === DaemonState.IDLE) {
			if (hasInteracted) {
				baseStatus = "SPACE vox :: SHIFT+TAB jack-in :: N new shard :: ? hotkeys";
			}
		}
		return baseStatus;
	}, [daemonState, isToolCalling, isReasoning, hasInteracted]);

	const statusColor = isToolCalling
		? COLORS.STATUS_RUNNING
		: isReasoning
			? COLORS.REASONING
			: STATE_COLOR_HEX[daemonState];

	const showWorkingSpinner = hasInteracted && daemonState === DaemonState.RESPONDING;
	const responseElapsedLabel = formatElapsedTime(responseElapsedMs);
	const workingSpinnerLabel = isToolCalling
		? `BREACHING I/O... :: ${responseElapsedLabel}`
		: isReasoning
			? `TRACING... :: ${responseElapsedLabel}`
			: `TRANSMITTING... :: ${responseElapsedLabel}`;

	const modelName = useMemo(() => {
		if (!preferencesLoaded) return undefined;
		if (modelMetadata?.name && modelMetadata.id === currentModelId) {
			return modelMetadata.name;
		}
		const selectedModel =
			availableModels.find((model) => model.id === currentModelId) ??
			curatedModels.find((model) => model.id === currentModelId);
		if (selectedModel?.name) {
			return currentModelProvider === "copilot"
				? `Copilot: ${selectedModel.name}`
				: selectedModel.name;
		}
		if (currentModelProvider === "copilot") {
			return `Copilot: ${currentModelId}`;
		}
		return undefined;
	}, [
		availableModels,
		curatedModels,
		currentModelProvider,
		modelMetadata,
		currentModelId,
		preferencesLoaded,
	]);

	const sessionTitle = useMemo(() => {
		if (!currentSessionId) return undefined;
		const session = sessionMenuItems.find((s) => s.id === currentSessionId);
		return session?.title;
	}, [currentSessionId, sessionMenuItems]);

	const avatarWidth = useMemo(
		() =>
			Math.max(
				AVATAR_MIN_WIDTH,
				Math.min(AVATAR_MAX_WIDTH, Math.floor(terminalWidth * AVATAR_WIDTH_PERCENT))
			),
		[terminalWidth]
	);

	const avatarHeight = useMemo(
		() =>
			Math.max(
				AVATAR_MIN_HEIGHT,
				Math.min(AVATAR_MAX_HEIGHT, Math.floor(terminalHeight * AVATAR_HEIGHT_PERCENT))
			),
		[terminalHeight]
	);

	const frostColor = hasInteracted ? "#090014C8" : COLORS.BACKGROUND;
	const isListening =
		daemonState === DaemonState.LISTENING || daemonState === DaemonState.TRANSCRIBING;
	const isListeningDim = isListening && hasInteracted;

	return {
		isToolCalling,
		isReasoning,
		statusText,
		statusColor,
		showWorkingSpinner,
		workingSpinnerLabel,
		modelName,
		sessionTitle,
		avatarWidth,
		avatarHeight,
		frostColor,
		isListening,
		isListeningDim,
	};
}
