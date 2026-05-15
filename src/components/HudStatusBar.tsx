/**
 * Enhanced status bar with ambient HUD badges: git state, active tasks, context budget.
 */

import type { HealthSnapshot } from "../health/orpheus-health";
import { COLORS } from "../ui/constants";
import type { ModelMetadata } from "../utils/model-metadata";

const SESSION_TITLE_MAX_LENGTH = 40;
const DEFAULT_TITLE_PATTERN = /^Session \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

function isDefaultSessionTitle(title: string): boolean {
	return DEFAULT_TITLE_PATTERN.test(title);
}

function truncateWithEllipsis(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength - 1) + "…";
}

export interface HudStatusBarProps {
	statusText: string;
	statusColor: string;
	errorText?: string;
	modelName?: string;
	sessionTitle?: string;
	hasInteracted?: boolean;
	healthSnapshot?: HealthSnapshot | null;
	// HUD additions
	gitDirty?: boolean;
	gitBranch?: string | null;
	activeTasks?: number;
	queuedTasks?: number;
	contextPercent?: number | null;
}

function contextGaugeColor(percent: number): string {
	if (percent >= 85) return COLORS.STATUS_FAILED;
	if (percent >= 70) return COLORS.STATUS_RUNNING;
	return COLORS.STATUS_COMPLETED;
}

export function HudStatusBar({
	statusText,
	statusColor,
	errorText,
	modelName,
	sessionTitle,
	hasInteracted,
	healthSnapshot,
	gitDirty,
	gitBranch,
	activeTasks,
	queuedTasks,
	contextPercent,
}: HudStatusBarProps) {
	const healthColor =
		healthSnapshot?.level === "blocked" || healthSnapshot?.level === "repair"
			? COLORS.STATUS_FAILED
			: healthSnapshot?.level === "watch"
				? COLORS.STATUS_RUNNING
				: COLORS.STATUS_COMPLETED;
	const healthLabel = healthSnapshot?.label ?? "HEALTH ...";

	const showTitleSpinner = sessionTitle && isDefaultSessionTitle(sessionTitle);
	const displayTitle =
		sessionTitle && !showTitleSpinner ? truncateWithEllipsis(sessionTitle, SESSION_TITLE_MAX_LENGTH) : null;

	const hudParts: string[] = [];
	if (gitDirty) hudParts.push(`git:${gitBranch ?? "dirty"}`);
	if ((activeTasks ?? 0) > 0) hudParts.push(`tasks:${activeTasks}`);
	if ((queuedTasks ?? 0) > 0) hudParts.push(`queue:${queuedTasks}`);
	if (contextPercent !== null && contextPercent !== undefined) {
		hudParts.push(`ctx:${Math.round(contextPercent)}%`);
	}

	return (
		<box
			width="100%"
			flexShrink={0}
			flexDirection="column"
			borderStyle="single"
			borderColor={COLORS.STATUS_BORDER}
			paddingTop={0}
			paddingLeft={1}
			paddingRight={1}
		>
			<box width="100%" flexDirection="row" justifyContent="center" alignItems="center">
				<box position="absolute" left={0} top={0} flexDirection="row" alignItems="center">
					{modelName && (
						<text>
							<span fg={COLORS.STATUS_BORDER}>{modelName}</span>
						</text>
					)}
					{hudParts.length > 0 && (
						<text marginLeft={1}>
							<span fg={COLORS.REASONING_DIM}>{hudParts.join(" · ")}</span>
						</text>
					)}
				</box>

				<text>
					<span fg={statusColor}>{statusText}</span>
				</text>

				<box position="absolute" right={0} top={0} flexDirection="row" alignItems="center">
					{contextPercent !== null && contextPercent !== undefined && (
						<text marginRight={2}>
							<span fg={contextGaugeColor(contextPercent)}>
								{`[${"=".repeat(Math.min(10, Math.round(contextPercent / 10)))}${" ".repeat(
									Math.max(0, 10 - Math.round(contextPercent / 10))
								)}]`}
							</span>
						</text>
					)}
					{healthSnapshot && (
						<text marginRight={2}>
							<span fg={healthColor}>{healthLabel}</span>
						</text>
					)}
					{showTitleSpinner && (
						<>
							<spinner name="dots" color={COLORS.STATUS_BORDER} />
							<text marginLeft={1}>
								<span fg={COLORS.STATUS_BORDER}>indexing session...</span>
							</text>
						</>
					)}
					{displayTitle && (
						<text>
							<span fg={COLORS.STATUS_BORDER}>{displayTitle}</span>
						</text>
					)}
				</box>
			</box>

			{errorText && (
				<box width="100%" flexDirection="row" justifyContent="center" alignItems="center" marginTop={1}>
					<text>
						<span fg={COLORS.DAEMON_ERROR}>{errorText}</span>
					</text>
				</box>
			)}
		</box>
	);
}
