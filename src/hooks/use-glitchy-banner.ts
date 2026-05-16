import { useEffect, useState } from "react";

import { STARTUP_BANNER_DURATION_MS } from "../ui/startup";

const DAEMON_BANNER_LINES = [
	"   ____   ____   ____   _   _   _____   _   _   ____",
	"  / __ \\ |  _ \\ |  _ \\ | | | | | ____| | | | | / ___|",
	" | |  | || |_) || |_) || |_| | |  _|   | | | | \\___ \\",
	" | |__| ||  _ < |  __/ |  _  | | |___  | |_| |  ___) |",
	"  \\____/ |_| \\_\\|_|    |_| |_| |_____|  \\___/  |____/",
];

const BANNER_GRADIENT = ["#f8fbff", "#00f5ff", "#ff3cc7", "#ff2f6d", "#ffd166"];

// glitch chars
const GLITCH_CHARS = "!@#$%^&*()_+-=[]{}|;:',.<>?/\\`~01ZXORPHEUS";

const BANNER_ANIMATION_DURATION = STARTUP_BANNER_DURATION_MS;
const LINE_STAGGER_MS = 80;

export interface GlitchyBannerState {
	lines: string[];
	colors: string[];
	progress: number;
	complete: boolean;
}

/**
 * Generates a glitched version of a string.
 * @param original The original string
 * @param glitchAmount 0-1, where 1 = fully glitched
 * @param revealProgress 0-1, where 1 = fully revealed from left
 */
function glitchString(original: string, glitchAmount: number, revealProgress: number): string {
	const revealedLength = Math.floor(original.length * revealProgress);
	let result = "";

	for (let i = 0; i < original.length; i++) {
		const char = original[i];

		if (i >= revealedLength) {
			// Not yet revealed - either empty or glitch
			if (Math.random() < glitchAmount * 0.7) {
				result += GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
			} else {
				result += " ";
			}
		} else {
			// Revealed area - occasional glitch corruption
			if (char !== " " && Math.random() < glitchAmount * 0.15) {
				result += GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
			} else {
				result += char;
			}
		}
	}

	return result;
}

/**
 * Generates glitched color with restrained neon-channel interference.
 */
function glitchColor(baseColor: string, glitchAmount: number): string {
	if (glitchAmount > 0.2 && Math.random() < glitchAmount * 0.4) {
		if (Math.random() < glitchAmount * 0.22) {
			const flashes = ["#ffffff", "#00f5ff", "#ff3cc7", "#ff2f6d", "#ffd166"];
			return flashes[Math.floor(Math.random() * flashes.length)] ?? baseColor;
		}
		const hex = baseColor.replace("#", "");
		const r = parseInt(hex.substring(0, 2), 16);
		const g = parseInt(hex.substring(2, 4), 16);
		const b = parseInt(hex.substring(4, 6), 16);

		const brightnessShift = (Math.random() - 0.25) * glitchAmount * 90;
		const newR = Math.max(0, Math.min(255, r + brightnessShift + Math.random() * 36));
		const newG = Math.max(0, Math.min(255, g + brightnessShift * 0.55 + Math.random() * 10));
		const newB = Math.max(0, Math.min(255, b + brightnessShift * 0.45 + Math.random() * 8));

		return `#${Math.round(newR).toString(16).padStart(2, "0")}${Math.round(newG).toString(16).padStart(2, "0")}${Math.round(newB).toString(16).padStart(2, "0")}`;
	}
	return baseColor;
}

export function useGlitchyBanner(isActive: boolean): GlitchyBannerState {
	const [state, setState] = useState<GlitchyBannerState>({
		lines: DAEMON_BANNER_LINES.map(() => ""),
		colors: BANNER_GRADIENT.map(() => "#000000"),
		progress: 0,
		complete: false,
	});

	// Animation loop
	useEffect(() => {
		if (!isActive) {
			setState({
				lines: DAEMON_BANNER_LINES.map(() => ""),
				colors: BANNER_GRADIENT.map(() => "#000000"),
				progress: 0,
				complete: false,
			});
			return;
		}

		const startTime = performance.now();
		const animate = () => {
			const elapsed = performance.now() - startTime;
			const progress = Math.min(1, elapsed / BANNER_ANIMATION_DURATION);

			if (progress >= 1) {
				// Animation complete, show final state
				setState({
					lines: [...DAEMON_BANNER_LINES],
					colors: [...BANNER_GRADIENT],
					progress: 1,
					complete: true,
				});
				return;
			}

			// Calculate glitch intensity (high at start, fades out)
			const glitchIntensity = Math.pow(1 - progress, 2);

			// Generate glitched lines with staggered reveal
			const lines = DAEMON_BANNER_LINES.map((line, i) => {
				const lineStartTime = i * LINE_STAGGER_MS;
				const lineElapsed = Math.max(0, elapsed - lineStartTime);
				const lineProgress = Math.min(
					1,
					lineElapsed / (BANNER_ANIMATION_DURATION - i * LINE_STAGGER_MS)
				);

				// Reveal from left + glitch effect
				const revealProgress = Math.pow(lineProgress, 0.7); // Ease out
				return glitchString(line, glitchIntensity, revealProgress);
			});

			// Generate colors with occasional glitch flash
			const colors = BANNER_GRADIENT.map((color, i) => {
				const lineStartTime = i * LINE_STAGGER_MS;
				const lineElapsed = Math.max(0, elapsed - lineStartTime);
				const lineProgress = Math.min(
					1,
					lineElapsed / (BANNER_ANIMATION_DURATION - i * LINE_STAGGER_MS)
				);

				if (lineProgress < 0.1) {
					return "#000000";
				}
				return glitchColor(color, glitchIntensity);
			});

			setState({
				lines,
				colors,
				progress,
				complete: false,
			});
		};

		// Run at ~30fps for glitchy effect
		const intervalId = setInterval(animate, 33);
		// Run once immediately
		animate();

		return () => clearInterval(intervalId);
	}, [isActive]);

	return state;
}

export { DAEMON_BANNER_LINES, BANNER_GRADIENT };
