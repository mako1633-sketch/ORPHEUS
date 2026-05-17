/**
 * Voice dependencies detection.
 * Detects whether sox is available for voice input/output.
 */

import { spawn } from "node:child_process";

export interface VoiceCapability {
	available: boolean;
	reason: string;
	hint?: string;
}

export interface VoiceDependencies {
	sox: VoiceCapability;
	/** Whether voice input (recording) is available */
	canRecordAudio: boolean;
	/** Whether voice output (TTS playback) is available */
	canPlayAudio: boolean;
}

// Cache the detection result
let cachedDependencies: VoiceDependencies | null = null;

/** Common absolute paths where sox may be installed outside PATH. */
const COMMON_SOX_PATHS = [
	"/opt/homebrew/bin/sox",
	"/usr/local/bin/sox",
	"/usr/bin/sox",
	"/bin/sox",
];

/**
 * Check if a binary exists by attempting to run it.
 * Accepts either a name (resolved via PATH) or an absolute path.
 */
async function checkBinary(binary: string): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn(binary, ["--version"], {
			stdio: ["ignore", "ignore", "ignore"],
		});

		proc.on("error", () => resolve(false));
		proc.on("close", (code) => resolve(code === 0));

		// Timeout after 2 seconds
		setTimeout(() => {
			proc.kill();
			resolve(false);
		}, 2000);
	});
}

/** Try to find sox on PATH or at a known fallback location. */
async function resolveSoxBinary(): Promise<string | null> {
	if (await checkBinary("sox")) return "sox";
	for (const p of COMMON_SOX_PATHS) {
		if (await checkBinary(p)) return p;
	}
	return null;
}

/**
 * Detect sox availability.
 */
async function detectSox(): Promise<VoiceCapability> {
	const path = await resolveSoxBinary();

	if (path) {
		return {
			available: true,
			reason: "sox is installed.",
		};
	}

	return {
		available: false,
		reason: "sox is not installed.",
		hint:
			process.platform === "darwin"
				? "Run: brew install sox"
				: "Install sox using your package manager.",
	};
}

/**
 * Detect all voice dependencies.
 * Results are cached after first detection.
 */
export async function detectVoiceDependencies(): Promise<VoiceDependencies> {
	if (cachedDependencies) {
		return cachedDependencies;
	}

	const sox = await detectSox();

	cachedDependencies = {
		sox,
		// Voice input requires sox for recording
		canRecordAudio: sox.available,
		// Voice output requires sox for playback
		canPlayAudio: sox.available,
	};

	return cachedDependencies;
}

/**
 * Get the cached voice dependencies (returns null if not yet detected).
 */
export function getCachedVoiceDependencies(): VoiceDependencies | null {
	return cachedDependencies;
}

/**
 * Clear the cached voice dependencies (useful for testing).
 */
export function clearVoiceDependenciesCache(): void {
	cachedDependencies = null;
}

/**
 * Synchronously check if sox is available.
 * Uses cached result if available, otherwise returns false.
 */
export function isSoxAvailable(): boolean {
	return cachedDependencies?.sox.available ?? false;
}
