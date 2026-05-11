import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";
import { getAppConfigDir } from "../../utils/preferences";

const execFileAsync = promisify(execFile);
const SCREENSHOT_TIMEOUT_MS = 10000;

function getScreenshotsDir(): string {
	return path.join(getAppConfigDir(), "screenshots");
}

function slugifyLabel(label: string | undefined): string {
	const slug = (label ?? "screenshot")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return slug || "screenshot";
}

function timestampForFilename(date = new Date()): string {
	return date.toISOString().replace(/[:.]/g, "-");
}

export async function captureScreenshot({
	label,
	includeCursor = false,
}: {
	label?: string;
	includeCursor?: boolean;
}): Promise<{
	success: boolean;
	path?: string;
	platform: NodeJS.Platform;
	error?: string;
}> {
	if (process.platform !== "darwin") {
		return {
			success: false,
			platform: process.platform,
			error: "Screenshot capture is currently implemented for macOS via screencapture.",
		};
	}

	const screenshotsDir = getScreenshotsDir();
	const screenshotPath = path.join(screenshotsDir, `${timestampForFilename()}-${slugifyLabel(label)}.png`);

	try {
		await fs.mkdir(screenshotsDir, { recursive: true });
		const args = includeCursor ? ["-C", screenshotPath] : [screenshotPath];
		await execFileAsync("screencapture", args, { timeout: SCREENSHOT_TIMEOUT_MS });

		return {
			success: true,
			path: screenshotPath,
			platform: process.platform,
		};
	} catch (error) {
		return {
			success: false,
			path: screenshotPath,
			platform: process.platform,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export const screenshot = tool({
	description:
		"Capture a macOS desktop screenshot and save it to the ORPHEUS screenshots directory. Use only when the user explicitly asks for a screenshot or visual capture.",
	inputSchema: z.object({
		label: z.string().optional().describe("Optional short label used in the screenshot filename."),
		includeCursor: z
			.boolean()
			.optional()
			.default(false)
			.describe("Whether to include the mouse cursor in the capture."),
	}),
	needsApproval: async () => true,
	execute: captureScreenshot,
});
