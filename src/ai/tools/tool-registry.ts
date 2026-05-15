import type { ToolSet } from "ai";

import { codingWorkbench } from "./coding-workbench";
import { daemonStatus } from "./daemon-status";
import { executiveAssistant } from "./executive-assistant";
import { fetchUrls } from "./fetch-urls";
import { groundingManager } from "./grounding-manager";
import { notes } from "./notes";
import { orpheusCli, resolveOrpheusCliPath } from "./orpheus-cli";
import { persistentContext } from "./persistent-context";
import { projectContext } from "./project-context";
import { readFile } from "./read-file";
import { renderUrl } from "./render-url";
import { runBash } from "./run-bash";
import { screenshot } from "./screenshot";
import { detectSignalCli, signal } from "./signal";
import { subagent } from "./subagents";
import { systemStatus } from "./system-status";
import { todoManager } from "./todo-manager";
import { webSearch } from "./web-search";
import { windowsHardening } from "./windows-hardening";
import { windowsSecurity } from "./windows-security";
import { writeFile } from "./write-file";

import type { ToolToggleId, ToolToggles } from "../../types";
import { detectLocalPlaywrightChromium } from "../../utils/js-rendering";
import { EXA_API_KEY_INVALID_MESSAGE, isCurrentExaApiKeyInvalid } from "../exa-client";
import { getProviderCapabilities } from "../providers/capabilities";

export type ToolId = ToolToggleId;

export interface ToolAvailabilityStatus {
	enabled: boolean;
	envAvailable: boolean;
	disabledReason?: string;
}

export type ToolAvailabilityMap = Record<ToolId, ToolAvailabilityStatus>;

type ToolEntry = {
	id: ToolId;
	tool: ToolSet[keyof ToolSet];
	toggleKey: ToolToggleId;
	gate?: (context: ToolGateContext) => Promise<ToolGateResult>;
};

type ToolGateContext = {
	toggles: ToolToggles;
};

type ToolGateResult = {
	envAvailable: boolean;
	disabledReason?: string;
};

const TOOL_REGISTRY: ToolEntry[] = [
	{ id: "readFile", toggleKey: "readFile", tool: readFile },
	{ id: "writeFile", toggleKey: "writeFile", tool: writeFile },
	{ id: "runBash", toggleKey: "runBash", tool: runBash },
	{ id: "windowsSecurity", toggleKey: "windowsSecurity", tool: windowsSecurity, gate: gateWindowsTool },
	{ id: "windowsHardening", toggleKey: "windowsHardening", tool: windowsHardening, gate: gateWindowsTool },
	{ id: "daemonStatus", toggleKey: "daemonStatus", tool: daemonStatus },
	{ id: "webSearch", toggleKey: "webSearch", tool: webSearch, gate: gateExa },
	{ id: "fetchUrls", toggleKey: "fetchUrls", tool: fetchUrls, gate: gateExa },
	{ id: "renderUrl", toggleKey: "renderUrl", tool: renderUrl, gate: gateRenderUrl },
	{ id: "signal", toggleKey: "signal", tool: signal, gate: gateSignal },
	{ id: "systemStatus", toggleKey: "systemStatus", tool: systemStatus },
	{ id: "persistentContext", toggleKey: "persistentContext", tool: persistentContext },
	{ id: "executiveAssistant", toggleKey: "executiveAssistant", tool: executiveAssistant },
	{ id: "projectContext", toggleKey: "projectContext", tool: projectContext },
	{ id: "codingWorkbench", toggleKey: "codingWorkbench", tool: codingWorkbench },
	{ id: "notes", toggleKey: "notes", tool: notes },
	{ id: "screenshot", toggleKey: "screenshot", tool: screenshot, gate: gateScreenshot },
	{ id: "todoManager", toggleKey: "todoManager", tool: todoManager },
	{ id: "groundingManager", toggleKey: "groundingManager", tool: groundingManager },
	{ id: "subagent", toggleKey: "subagent", tool: subagent, gate: gateSubagent },
	{ id: "orpheusCli", toggleKey: "orpheusCli", tool: orpheusCli, gate: gateOrpheusCli },
];

function gateExa(): Promise<ToolGateResult> {
	const hasKey = Boolean(process.env.EXA_API_KEY);
	if (hasKey && isCurrentExaApiKeyInvalid()) {
		return Promise.resolve({
			envAvailable: false,
			disabledReason: EXA_API_KEY_INVALID_MESSAGE,
		});
	}
	return Promise.resolve({
		envAvailable: hasKey,
		disabledReason: hasKey ? undefined : "EXA_API_KEY not configured",
	});
}

function gateWindowsTool(): Promise<ToolGateResult> {
	const isWindows = process.platform === "win32";
	return Promise.resolve({
		envAvailable: isWindows,
		disabledReason: isWindows ? undefined : "Windows-only tool is unavailable on this platform.",
	});
}

async function gateRenderUrl(): Promise<ToolGateResult> {
	const capability = await detectLocalPlaywrightChromium();
	return {
		envAvailable: capability.available,
		disabledReason: capability.available ? undefined : capability.reason,
	};
}

async function gateSignal(): Promise<ToolGateResult> {
	const capability = await detectSignalCli();
	return {
		envAvailable: capability.available,
		disabledReason: capability.available ? undefined : capability.reason,
	};
}

function gateScreenshot(): Promise<ToolGateResult> {
	const isMac = process.platform === "darwin";
	return Promise.resolve({
		envAvailable: isMac,
		disabledReason: isMac ? undefined : "Screenshot capture currently requires macOS screencapture.",
	});
}

function gateSubagent(): Promise<ToolGateResult> {
	const capabilities = getProviderCapabilities();
	if (!capabilities.supportsSubagentTool) {
		return Promise.resolve({
			envAvailable: false,
			disabledReason: "Subagent tool is unavailable for the current model provider.",
		});
	}

	return Promise.resolve({
		envAvailable: true,
	});
}

function gateOrpheusCli(): Promise<ToolGateResult> {
	const exists = Boolean(resolveOrpheusCliPath());
	return Promise.resolve({
		envAvailable: exists,
		disabledReason: exists ? undefined : "ORPHEUS CLI bin not found.",
	});
}

function normalizeToggles(toggles?: ToolToggles): ToolToggles {
	return {
		readFile: toggles?.readFile ?? true,
		writeFile: toggles?.writeFile ?? true,
		runBash: toggles?.runBash ?? true,
		windowsSecurity: toggles?.windowsSecurity ?? true,
		windowsHardening: toggles?.windowsHardening ?? true,
		daemonStatus: toggles?.daemonStatus ?? true,
		webSearch: toggles?.webSearch ?? true,
		fetchUrls: toggles?.fetchUrls ?? true,
		renderUrl: toggles?.renderUrl ?? true,
		signal: toggles?.signal ?? true,
		systemStatus: toggles?.systemStatus ?? true,
		persistentContext: toggles?.persistentContext ?? true,
		executiveAssistant: toggles?.executiveAssistant ?? true,
		projectContext: toggles?.projectContext ?? true,
		codingWorkbench: toggles?.codingWorkbench ?? true,
		notes: toggles?.notes ?? true,
		screenshot: toggles?.screenshot ?? true,
		todoManager: toggles?.todoManager ?? true,
		groundingManager: toggles?.groundingManager ?? true,
		subagent: toggles?.subagent ?? true,
		orpheusCli: toggles?.orpheusCli ?? true,
	};
}

function selectRegistryTools(only: ToolId[] | null): ToolEntry[] {
	if (!only) return TOOL_REGISTRY;
	return TOOL_REGISTRY.filter((entry) => only.includes(entry.id));
}

function omitRegistryTools(omit: ToolId[] | null): ToolEntry[] {
	if (!omit) return TOOL_REGISTRY;
	return TOOL_REGISTRY.filter((entry) => !omit.includes(entry.id));
}

export interface BuildToolsOptions {
	only?: ToolId[];
	omit?: ToolId[];
}

export async function resolveToolAvailability(
	toggles: ToolToggles,
	options: BuildToolsOptions = {}
): Promise<ToolAvailabilityMap> {
	const normalizedToggles = normalizeToggles(toggles);
	const entries = options.only ? selectRegistryTools(options.only) : omitRegistryTools(options.omit ?? null);
	const results: ToolAvailabilityMap = {} as ToolAvailabilityMap;

	for (const entry of entries) {
		const toggleEnabled = Boolean(normalizedToggles[entry.toggleKey]);
		const gateResult = entry.gate ? await entry.gate({ toggles: normalizedToggles }) : { envAvailable: true };
		results[entry.id] = {
			enabled: toggleEnabled && gateResult.envAvailable,
			envAvailable: gateResult.envAvailable,
			disabledReason: gateResult.disabledReason,
		};
	}

	return results;
}

export function buildMenuItems(availability: ToolAvailabilityMap): Record<
	ToolId,
	{
		id: ToolId;
		label: string;
		envAvailable: boolean;
		disabledReason?: string;
	}
> {
	const labels = getToolLabels();
	const ordered = getDefaultToolOrder();
	const entries = ordered.map((id) => {
		const status = availability[id];
		return {
			id,
			label: labels[id],
			envAvailable: status?.envAvailable ?? true,
			disabledReason: status?.disabledReason,
		};
	});

	return Object.fromEntries(entries.map((entry) => [entry.id, entry])) as Record<
		ToolId,
		{
			id: ToolId;
			label: string;
			envAvailable: boolean;
			disabledReason?: string;
		}
	>;
}

export async function buildToolSet(
	toggles: ToolToggles,
	options: BuildToolsOptions = {}
): Promise<{ tools: ToolSet; availability: ToolAvailabilityMap }> {
	const availability = await resolveToolAvailability(toggles, options);
	const entries = options.only ? selectRegistryTools(options.only) : omitRegistryTools(options.omit ?? null);
	const tools: ToolSet = {};

	for (const entry of entries) {
		const status = availability[entry.id];
		if (!status?.enabled) continue;
		(tools as ToolSet & Record<ToolId, ToolSet[keyof ToolSet]>)[entry.id] = entry.tool;
	}

	return { tools, availability };
}

export function getToolLabels(): Record<ToolId, string> {
	return {
		readFile: "readFile",
		writeFile: "writeFile",
		runBash: "runShell",
		windowsSecurity: "windowsSecurity",
		windowsHardening: "windowsHardening",
		daemonStatus: "daemonStatus",
		webSearch: "webSearch",
		fetchUrls: "fetchUrls",
		renderUrl: "renderUrl",
		signal: "signal",
		systemStatus: "systemStatus",
		persistentContext: "persistentContext",
		executiveAssistant: "executiveAssistant",
		projectContext: "projectContext",
		codingWorkbench: "codingWorkbench",
		notes: "notes",
		screenshot: "screenshot",
		todoManager: "todoManager",
		groundingManager: "groundingManager",
		subagent: "subagent",
		orpheusCli: "orpheusCli",
	};
}

export function getDefaultToolOrder(): ToolId[] {
	return [
		"readFile",
		"writeFile",
		"runBash",
		"windowsSecurity",
		"windowsHardening",
		"daemonStatus",
		"webSearch",
		"fetchUrls",
		"renderUrl",
		"signal",
		"systemStatus",
		"persistentContext",
		"executiveAssistant",
		"projectContext",
		"codingWorkbench",
		"notes",
		"screenshot",
		"todoManager",
		"groundingManager",
		"subagent",
		"orpheusCli",
	];
}

export function createToolAvailabilitySnapshot(availability: ToolAvailabilityMap): Record<ToolId, boolean> {
	return {
		readFile: availability.readFile?.enabled ?? false,
		writeFile: availability.writeFile?.enabled ?? false,
		runBash: availability.runBash?.enabled ?? false,
		windowsSecurity: availability.windowsSecurity?.enabled ?? false,
		windowsHardening: availability.windowsHardening?.enabled ?? false,
		daemonStatus: availability.daemonStatus?.enabled ?? false,
		webSearch: availability.webSearch?.enabled ?? false,
		fetchUrls: availability.fetchUrls?.enabled ?? false,
		renderUrl: availability.renderUrl?.enabled ?? false,
		signal: availability.signal?.enabled ?? false,
		systemStatus: availability.systemStatus?.enabled ?? false,
		persistentContext: availability.persistentContext?.enabled ?? false,
		executiveAssistant: availability.executiveAssistant?.enabled ?? false,
		projectContext: availability.projectContext?.enabled ?? false,
		codingWorkbench: availability.codingWorkbench?.enabled ?? false,
		notes: availability.notes?.enabled ?? false,
		screenshot: availability.screenshot?.enabled ?? false,
		todoManager: availability.todoManager?.enabled ?? false,
		groundingManager: availability.groundingManager?.enabled ?? false,
		subagent: availability.subagent?.enabled ?? false,
		orpheusCli: availability.orpheusCli?.enabled ?? false,
	};
}
