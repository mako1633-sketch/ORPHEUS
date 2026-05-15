/**
 * Multi-Modal Vision Integration
 * Wires the existing screenshot capability into the reasoning loop.
 * When a user asks about a visual state (terminal error, UI bug, diagram),
 * ORPHEUS captures the screen and passes the image path alongside the query
 * to a vision-capable model for analysis.
 */

import { tool } from "ai";
import { z } from "zod";
import { captureScreenshot } from "./tools/screenshot";

export interface VisionAnalysisRequest {
	userMessage: string;
	label?: string;
	includeCursor?: boolean;
}

export interface VisionAnalysisResult {
	success: boolean;
	screenshotPath?: string;
	analysis?: string;
	error?: string;
}

/**
 * Detects if a user message implies they want visual analysis.
 */
export function isVisionRequest(userMessage: string): boolean {
	const triggers = [
		"screenshot",
		"screen",
		"what do you see",
		"look at",
		"visual",
		"image",
		"ui",
		"interface",
		"window",
		"dialog",
		"error dialog",
		"popup",
		"terminal",
		"console",
		"output",
		"traceback",
		"stack trace",
		"diagram",
		"chart",
		"graph",
		"blueprint",
		"mockup",
		"design",
		"why is this failing",
		"what's wrong",
		"what's this error",
	];
	const lower = userMessage.toLowerCase();
	return triggers.some((t) => lower.includes(t));
}

/**
 * Capture a screenshot and return it as a tool result for downstream vision model use.
 * The actual image-to-text analysis happens in the agent turn runner when it sees
 * a screenshot tool result paired with a vision-capable model.
 */
export async function performVisionAnalysis(request: VisionAnalysisRequest): Promise<VisionAnalysisResult> {
	const screenshot = await captureScreenshot({
		label: request.label ?? "vision-analysis",
		includeCursor: request.includeCursor ?? false,
	});

	if (!screenshot.success || !screenshot.path) {
		return {
			success: false,
			error: screenshot.error ?? "Screenshot capture failed",
		};
	}

	return {
		success: true,
		screenshotPath: screenshot.path,
		analysis: `Screenshot captured at ${screenshot.path}. Ready for visual analysis.`,
	};
}

/**
 * Tool definition for the vision reasoning pipeline.
 * Registered alongside other tools; the runner decides when to invoke it.
 */
export const visionReasoningTool = tool({
	description:
		"Capture a screenshot for visual analysis when the user asks about something on screen, a UI error, a diagram, or any visual state. Only triggers automatically when the message implies visual context is needed.",
	inputSchema: z.object({
		userMessage: z.string().describe("The user's message that triggered vision analysis."),
		label: z.string().optional().describe("Optional label for the screenshot filename."),
		includeCursor: z.boolean().optional().default(false).describe("Whether to include the mouse cursor."),
	}),
	needsApproval: async () => true,
	execute: async ({ userMessage, label, includeCursor }) => {
		return performVisionAnalysis({ userMessage, label, includeCursor });
	},
});
