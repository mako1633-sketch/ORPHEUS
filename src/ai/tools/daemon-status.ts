import { existsSync } from "node:fs";
import { tool } from "ai";
import { z } from "zod";
import { EXA_API_KEY_INVALID_MESSAGE, isCurrentExaApiKeyInvalid } from "../exa-client";
import { getProviderCapabilities } from "../providers/capabilities";
import { getKeyHealth } from "../../utils/key-health";
import { getWindowsPowerShellPath } from "./run-bash";
import { detectSignalCli } from "./signal";

type StatusLevel = "ok" | "missing" | "invalid" | "unavailable";

type StatusItem = {
	id: string;
	label: string;
	status: StatusLevel;
	detail: string;
};

function keyStatus(envName: string, invalid = false): StatusItem {
	const configured = Boolean(process.env[envName]);
	return {
		id: envName,
		label: envName,
		status: invalid ? "invalid" : configured ? "ok" : "missing",
		detail: invalid
			? `${envName} is configured but currently marked invalid.`
			: configured
				? "Configured."
				: "Not configured.",
	};
}

export async function buildDaemonStatusItems(): Promise<StatusItem[]> {
	const powerShellPath = getWindowsPowerShellPath();
	const signalCapability = await detectSignalCli();
	const providerCapabilities = getProviderCapabilities();
	const shellLabel = process.platform === "win32" ? "Windows PowerShell" : "Local shell";
	const shellDetail = process.platform === "win32" ? powerShellPath : "Using bash for local commands.";

	return [
		...getKeyHealth().map((item) => ({
			id: `format:${item.name}`,
			label: `${item.name} format`,
			status:
				item.status === "configured"
					? ("ok" as const)
					: item.status === "missing"
						? ("missing" as const)
						: ("invalid" as const),
			detail: item.message,
		})),
		keyStatus("OPENAI_API_KEY"),
		keyStatus("OPENROUTER_API_KEY"),
		keyStatus("EXA_API_KEY", isCurrentExaApiKeyInvalid()),
		{
			id: "ollama",
			label: "Ollama endpoint",
			status: process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST ? "ok" : "missing",
			detail:
				process.env.OLLAMA_BASE_URL ||
				process.env.OLLAMA_HOST ||
				"Using provider defaults if Ollama is selected.",
		},
		{
			id: "powershell",
			label: shellLabel,
			status: process.platform === "win32" && !existsSync(powerShellPath) ? "unavailable" : "ok",
			detail: shellDetail,
		},
		{
			id: "signal",
			label: "Signal CLI",
			status: signalCapability.available ? "ok" : "unavailable",
			detail: signalCapability.available
				? "Available."
				: (signalCapability.reason ?? "signal-cli was not detected."),
		},
		{
			id: "subagent",
			label: "Subagents",
			status: providerCapabilities.supportsSubagentTool ? "ok" : "unavailable",
			detail: providerCapabilities.supportsSubagentTool
				? "Supported by the current provider."
				: "Unavailable for the current provider.",
		},
	];
}

export const daemonStatus = tool({
	description:
		"Run a local ORPHEUS capability doctor check. Reports provider key presence, EXA key health, local shell readiness, Signal CLI availability, and subagent support without revealing secret values.",
	inputSchema: z.object({
		scope: z.enum(["all"]).default("all").describe("Status scope. Currently only all is supported."),
	}),
	execute: async () => {
		const items = await buildDaemonStatusItems();
		const invalidExa = items.find((item) => item.id === "EXA_API_KEY" && item.status === "invalid");
		return {
			success: true,
			items: items.map((item) =>
				item.id === "EXA_API_KEY" && item.status === "invalid"
					? { ...item, detail: EXA_API_KEY_INVALID_MESSAGE }
					: item
			),
			summary: {
				ok: items.filter((item) => item.status === "ok").length,
				needsAttention: items.filter((item) => item.status !== "ok").length,
				exaInvalid: Boolean(invalidExa),
			},
		};
	},
});
