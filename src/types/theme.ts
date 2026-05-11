/**
 * Avatar and UI color themes for different ORPHEUS states.
 */

import { DaemonState } from "./index";
import type { AvatarColorTheme } from "./index";

/**
 * Avatar color themes for each ORPHEUS state
 */
export const STATE_COLORS: Record<DaemonState, AvatarColorTheme> = {
	[DaemonState.IDLE]: {
		primary: 0x00f5ff,
		glow: 0xff2bd6,
		eye: 0xfcee0a,
	},
	[DaemonState.LISTENING]: {
		primary: 0xff2bd6,
		glow: 0x00f5ff,
		eye: 0xff2a6d,
	},
	[DaemonState.TRANSCRIBING]: {
		primary: 0xfcee0a,
		glow: 0xff2bd6,
		eye: 0x00f5ff,
	},
	[DaemonState.RESPONDING]: {
		primary: 0xff2a6d,
		glow: 0x00f5ff,
		eye: 0xfcee0a,
	},
	[DaemonState.SPEAKING]: {
		primary: 0x00f5ff,
		glow: 0xa76dff,
		eye: 0xff2bd6,
	},
	[DaemonState.TYPING]: {
		primary: 0xfcee0a,
		glow: 0xff2a6d,
		eye: 0x00f5ff,
	},
};

/**
 * Special color theme for reasoning phase (before speaking).
 * Violet-pink scan state: hot, alien, and unstable.
 */
export const REASONING_COLORS: AvatarColorTheme = {
	primary: 0xa76dff,
	glow: 0xff2bd6,
	eye: 0x00f5ff,
};
