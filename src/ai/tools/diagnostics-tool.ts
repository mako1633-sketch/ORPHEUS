import { tool } from "ai";
import { z } from "zod";
import {
	formatDiagnosticReport,
	probeAppState,
	probeKeyboardState,
	probeOllamaModels,
	runFullDiagnostic,
} from "../../utils/diagnostics";

export const diagnostics = tool({
	description:
		"Run ORPHEUS runtime self-diagnostics. Probes keyboard state, Ollama connectivity, app context, and system health. Returns a structured diagnostic report formatted for both machine parsing and human reading. Use this to verify local environment health before or during development work.",
	inputSchema: z.object({
		scope: z
			.enum(["full", "ollama", "keyboard", "appState"])
			.default("full")
			.describe("Which probe to run: full report, or a single probe."),
		format: z
			.enum(["structured", "human"])
			.default("human")
			.describe("Return raw JSON (structured) or formatted text (human)."),
	}),
	execute: async ({ scope, format }) => {
		if (scope === "full") {
			const report = await runFullDiagnostic();
			return {
				success: true,
				data: format === "human" ? formatDiagnosticReport(report) : report,
			};
		}

		if (scope === "ollama") {
			const result = await probeOllamaModels();
			return { success: result.success, data: result.data ?? result.error };
		}

		if (scope === "keyboard") {
			const result = probeKeyboardState();
			return { success: result.success, data: result.data ?? result.error };
		}

		if (scope === "appState") {
			const result = probeAppState();
			return { success: result.success, data: result.data ?? result.error };
		}

		return { success: false, error: `Unknown diagnostic scope: ${scope}` };
	},
});
