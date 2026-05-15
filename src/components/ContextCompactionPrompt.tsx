/**
 * Inline prompt that appears when context budget crosses the critical threshold.
 * Suggests starting a fresh session to free the context window.
 */

import { DaemonState } from "../types";
import { COLORS } from "../ui/constants";

export interface ContextCompactionPromptProps {
	contextPercent: number | null;
	daemonState: DaemonState;
}

export function ContextCompactionPrompt({ contextPercent, daemonState }: ContextCompactionPromptProps) {
	const percent = contextPercent ?? 0;
	const isCritical = percent >= 85;
	const canAct = daemonState === DaemonState.IDLE || daemonState === DaemonState.SPEAKING;

	if (!isCritical || !canAct) {
		return null;
	}

	return (
		<box
			height={1}
			width="100%"
			flexShrink={0}
			flexDirection="row"
			justifyContent="center"
			alignItems="center"
			marginTop={1}
		>
			<text>
				<span fg={COLORS.STATUS_FAILED}>
					{`⚠ CONTEXT AT ${Math.round(percent)}% · Press C to start a fresh session`}
				</span>
			</text>
		</box>
	);
}
