/**
 * Hook for managing typing mode state and handlers.
 */

import type { TextareaRenderable } from "@opentui/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDaemonManager } from "../state/daemon-state";
import { DaemonState } from "../types";
import { getStartupActionForInput } from "../ui/startup-actions";

export interface UseTypingModeParams {
	daemonState: DaemonState;
	hasInteracted: boolean;
	currentUserInputRef: React.MutableRefObject<string>;
	setCurrentTranscription: (text: string) => void;
	onTypingActivity?: () => void;
	navigateUp: (currentInput: string) => string | null;
	navigateDown: () => string | null;
	resetNavigation: () => void;
}

export interface UseTypingModeReturn {
	typingInput: string;
	setTypingInput: React.Dispatch<React.SetStateAction<string>>;
	typingTextareaRef: React.RefObject<TextareaRenderable | null>;
	handleTypingContentChange: (value: string) => void;
	handleTypingSubmit: () => void;
	prefillTypingInput: (text: string) => void;
	handleHistoryUp: () => void;
	handleHistoryDown: () => void;
}

export function useTypingMode(params: UseTypingModeParams): UseTypingModeReturn {
	const {
		daemonState,
		hasInteracted,
		currentUserInputRef,
		setCurrentTranscription,
		onTypingActivity,
		navigateUp,
		navigateDown,
		resetNavigation,
	} = params;

	const [typingInput, setTypingInput] = useState<string>("");
	const typingTextareaRef = useRef<TextareaRenderable | null>(null);
	const pendingPrefillRef = useRef<string | null>(null);

	useEffect(() => {
		if (daemonState === DaemonState.TYPING && pendingPrefillRef.current !== null) {
			const text = pendingPrefillRef.current;
			const tryApplyPrefill = () => {
				if (typingTextareaRef.current) {
					typingTextareaRef.current.setText(text);
					typingTextareaRef.current.gotoBufferEnd();
					pendingPrefillRef.current = null;
				} else {
					setTimeout(tryApplyPrefill, 10);
				}
			};
			tryApplyPrefill();
		}
	}, [daemonState]);

	useEffect(() => {
		if (daemonState !== DaemonState.TYPING) {
			if (typingTextareaRef.current?.plainText) {
				typingTextareaRef.current.setText("");
			}
			setTypingInput("");
			pendingPrefillRef.current = null;
			resetNavigation();
		}
	}, [daemonState, resetNavigation]);

	const handleTypingContentChange = useCallback(
		(value: string) => {
			setTypingInput(value);
			onTypingActivity?.();
		},
		[onTypingActivity]
	);

	const handleTypingSubmit = useCallback(() => {
		const rawInput = typingTextareaRef.current?.plainText ?? typingInput;
		const input = rawInput.trim();
		if (input) {
			const startupAction = getStartupActionForInput(input, { allowBareNumber: !hasInteracted });
			const submittedText = startupAction?.prompt ?? input;
			const manager = getDaemonManager();
			currentUserInputRef.current = submittedText;
			setCurrentTranscription(submittedText);
			manager.submitText(submittedText);
		}
		typingTextareaRef.current?.setText("");
		setTypingInput("");
	}, [typingInput, hasInteracted, setCurrentTranscription, currentUserInputRef]);

	const prefillTypingInput = useCallback((text: string) => {
		setTypingInput(text);
		pendingPrefillRef.current = text;
		if (typingTextareaRef.current) {
			typingTextareaRef.current.setText(text);
			typingTextareaRef.current.gotoBufferEnd();
			pendingPrefillRef.current = null;
		}
	}, []);

	const setTextareaValue = useCallback((value: string) => {
		setTypingInput(value);
		if (typingTextareaRef.current) {
			typingTextareaRef.current.setText(value);
			typingTextareaRef.current.gotoBufferEnd();
		}
	}, []);

	const handleHistoryUp = useCallback(() => {
		const currentInput = typingTextareaRef.current?.plainText ?? typingInput;
		const historyItem = navigateUp(currentInput);
		if (historyItem !== null) {
			setTextareaValue(historyItem);
		}
	}, [typingInput, navigateUp, setTextareaValue]);

	const handleHistoryDown = useCallback(() => {
		const historyItem = navigateDown();
		if (historyItem !== null) {
			setTextareaValue(historyItem);
		}
	}, [navigateDown, setTextareaValue]);

	return {
		typingInput,
		setTypingInput,
		typingTextareaRef,
		handleTypingContentChange,
		handleTypingSubmit,
		prefillTypingInput,
		handleHistoryUp,
		handleHistoryDown,
	};
}
