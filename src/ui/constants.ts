/**
 * UI constants including colors, status text, and markdown syntax styles.
 */

import { RGBA, SyntaxStyle } from "@opentui/core";
import { DaemonState } from "../types";

// Status text displayed for each ORPHEUS state.
export const STATUS_TEXT: Record<DaemonState, string> = {
	[DaemonState.IDLE]: "BLACKWALL IDLE :: SPACE VOX :: SHIFT+TAB CONSOLE :: M MODELS :: S CONFIG :: ? HELP",
	[DaemonState.LISTENING]: "MIC HOT :: SPACE CUT FEED :: ESC ABORT",
	[DaemonState.TRANSCRIBING]: "VOICEPRINT PARSE :: ESC ABORT",
	[DaemonState.RESPONDING]: "ORPHEUS ONLINE :: ESC ABORT :: R TRACE",
	[DaemonState.SPEAKING]: "SYNTH STREAM :: ESC SILENCE",
	[DaemonState.TYPING]: "COMMAND CONSOLE :: ENTER EXEC :: ESC ABORT",
};

// Hex colors for status bar text per state.
export const STATE_COLOR_HEX: Record<DaemonState, string> = {
	[DaemonState.IDLE]: "#00f5ff",
	[DaemonState.LISTENING]: "#ff3cc7",
	[DaemonState.TRANSCRIBING]: "#ffd166",
	[DaemonState.RESPONDING]: "#ff2f6d",
	[DaemonState.SPEAKING]: "#00f5ff",
	[DaemonState.TYPING]: "#ffd166",
};

// Animation settings for reasoning text ticker.
export const REASONING_ANIMATION = {
	LINE_WIDTH: 200,
	CHARS_PER_TICK: 10,
	TICK_INTERVAL_MS: 10,
	SEGMENT_LENGTH: 5,
	PREFIX_COLOR: "#ff2f6d",
	INTENSITY: 0.72,
} as const;

// UI colors.
export const COLORS = {
	BACKGROUND: "#05070d",
	LISTENING_DIM: "#05070dcc",
	ERROR: "#ff375f",
	DAEMON_ERROR: "#ff375f",
	REASONING: "#ffd166",
	REASONING_DIM: "#6b5cff",
	TOOLS: "#00e5ff",
	TOOL_INPUT_BG: "#0b0e19e8",
	TOOL_INPUT_BORDER: "#ff3cc7cc",
	TOOL_INPUT_TEXT: "#c9fff7",
	USER_LABEL: "#ffd166",
	USER_TEXT: "#f8fbff",
	USER_BG: "#111827",
	DAEMON_LABEL: "#00f5ff",
	DAEMON_TEXT: "#ff3cc7",
	TYPING_PROMPT: "#ffd166",
	EMPTY_STATE: "#25304a",
	MENU_BORDER: "#00f5ff",
	MENU_BG: "#070a12",
	MENU_SELECTED_BG: "#151a2b",
	MENU_TEXT: "#dff7ff",
	TOKEN_USAGE: "#b58cff",
	TOKEN_USAGE_LABEL: "#6b5cff",
	STATUS_BORDER: "#ff3cc7",
	WORKING_SPINNER_BORDER: "#25233f",

	// General status colors used across tool views, todos, and subagent steps.
	STATUS_RUNNING: "#ffd166",
	STATUS_COMPLETED: "#00f5ff",
	STATUS_FAILED: "#ff375f",
	STATUS_PENDING: "#dff7ff",
	STATUS_DONE_DIM: "#25304a",
	STATUS_APPROVAL: "#ff3cc7",
} as const;

// Markdown syntax style for ORPHEUS responses - phosphor terminal aesthetic.
export const DAEMON_MARKDOWN_STYLE = SyntaxStyle.fromStyles({
	default: { fg: RGBA.fromHex(COLORS.DAEMON_TEXT) },
	"markup.heading.1": { fg: RGBA.fromHex("#ffd166"), bold: true },
	"markup.heading.2": { fg: RGBA.fromHex("#00f5ff"), bold: true },
	"markup.heading.3": { fg: RGBA.fromHex("#ff3cc7"), bold: true },
	"markup.heading.4": { fg: RGBA.fromHex("#b58cff") },
	"markup.heading.5": { fg: RGBA.fromHex("#b58cff") },
	"markup.heading.6": { fg: RGBA.fromHex("#b58cff") },
	"markup.strong": { fg: RGBA.fromHex("#f8fbff"), bold: true },
	"markup.italic": { fg: RGBA.fromHex("#00f5ff"), italic: true },
	"markup.strikethrough": { fg: RGBA.fromHex("#6b5cff"), dim: true },
	"markup.raw": { fg: RGBA.fromHex("#ffd166") },
	"markup.raw.block": { fg: RGBA.fromHex("#ffd166") },
	"markup.link": { fg: RGBA.fromHex("#00f5ff") },
	"markup.link.url": { fg: RGBA.fromHex("#00f5ff"), underline: true },
	"markup.link.label": { fg: RGBA.fromHex("#00f5ff") },
	"markup.list": { fg: RGBA.fromHex("#dff7ff") },
	"markup.list.checked": { fg: RGBA.fromHex("#00f5ff") },
	"markup.list.unchecked": { fg: RGBA.fromHex("#6b5cff") },
	"markup.quote": { fg: RGBA.fromHex("#b58cff"), italic: true },
	keyword: { fg: RGBA.fromHex("#ff2f6d") },
	string: { fg: RGBA.fromHex("#00f5ff") },
	comment: { fg: RGBA.fromHex("#6b5cff"), italic: true },
	number: { fg: RGBA.fromHex("#ffd166") },
	function: { fg: RGBA.fromHex("#ff3cc7") },
	type: { fg: RGBA.fromHex("#ffd166") },
	variable: { fg: RGBA.fromHex("#00f5ff") },
	constant: { fg: RGBA.fromHex("#ffd166") },
	operator: { fg: RGBA.fromHex("#ff2f6d") },
	punctuation: { fg: RGBA.fromHex("#dff7ff") },
	"punctuation.special": { fg: RGBA.fromHex("#b58cff") },
	label: { fg: RGBA.fromHex("#00f5ff") },
});

export const REASONING_MARKDOWN_STYLE = SyntaxStyle.fromStyles({
	default: { fg: RGBA.fromHex(COLORS.REASONING_DIM) },
	"markup.heading.1": { fg: RGBA.fromHex("#ff2f6d"), bold: true },
	"markup.heading.2": { fg: RGBA.fromHex("#b58cff"), bold: true },
	"markup.heading.3": { fg: RGBA.fromHex("#00f5ff"), bold: true },
	"markup.heading.4": { fg: RGBA.fromHex("#b58cff") },
	"markup.heading.5": { fg: RGBA.fromHex("#b58cff") },
	"markup.heading.6": { fg: RGBA.fromHex("#b58cff") },
	"markup.strong": { fg: RGBA.fromHex("#ffd166"), bold: true },
	"markup.italic": { fg: RGBA.fromHex("#00f5ff"), italic: true },
	"markup.strikethrough": { fg: RGBA.fromHex("#25304a"), dim: true },
	"markup.raw": { fg: RGBA.fromHex("#ffd166") },
	"markup.raw.block": { fg: RGBA.fromHex("#ffd166") },
	"markup.link": { fg: RGBA.fromHex("#00f5ff") },
	"markup.link.url": { fg: RGBA.fromHex("#00f5ff"), underline: true },
	"markup.link.label": { fg: RGBA.fromHex("#00f5ff") },
	"markup.list": { fg: RGBA.fromHex("#6b5cff") },
	"markup.list.checked": { fg: RGBA.fromHex("#00f5ff") },
	"markup.list.unchecked": { fg: RGBA.fromHex("#25304a") },
	"markup.quote": { fg: RGBA.fromHex("#6b5cff"), italic: true },
	keyword: { fg: RGBA.fromHex("#ff3cc7") },
	string: { fg: RGBA.fromHex("#00f5ff") },
	comment: { fg: RGBA.fromHex("#25304a"), italic: true },
	number: { fg: RGBA.fromHex("#ffd166") },
	function: { fg: RGBA.fromHex("#ff2f6d") },
	type: { fg: RGBA.fromHex("#ffd166") },
	variable: { fg: RGBA.fromHex("#00f5ff") },
	constant: { fg: RGBA.fromHex("#ffd166") },
	operator: { fg: RGBA.fromHex("#ff3cc7") },
	punctuation: { fg: RGBA.fromHex("#6b5cff") },
	"punctuation.special": { fg: RGBA.fromHex("#25304a") },
	label: { fg: RGBA.fromHex("#00f5ff") },
});
