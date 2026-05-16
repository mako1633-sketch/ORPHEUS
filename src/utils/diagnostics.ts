/**
 * Runtime self-diagnostics for ORPHEUS.
 * Probes keyboard state, Ollama connectivity, app context, and system health.
 * All results are structured for machine parsing and human reading.
 */

import { getOllamaBaseUrl } from "../ai/model-config";
import { debug } from "./debug-logger";

export interface ProbeResult<T> {
	success: boolean;
	data?: T;
	error?: string;
	responseTimeMs: number;
}

export interface OllamaProbeData {
	baseUrl: string;
	reachable: boolean;
	modelCount: number;
	models: string[];
}

export interface KeyboardProbeData {
	platform: NodeJS.Platform;
	stdinIsTTY: boolean;
	stdoutIsTTY: boolean;
}

export interface AppStateProbeData {
	nodeVersion: string;
	platform: NodeJS.Platform;
	arch: string;
	ollamaBaseUrl: string;
}

export interface DiagnosticReport {
	timestamp: string;
	probes: {
		ollama: ProbeResult<OllamaProbeData>;
		keyboard: ProbeResult<KeyboardProbeData>;
		appState: ProbeResult<AppStateProbeData>;
	};
	overallHealthy: boolean;
}

export async function probeOllamaModels(): Promise<ProbeResult<OllamaProbeData>> {
	const start = performance.now();
	const baseUrl = getOllamaBaseUrl().replace(/\/v1$/, "");
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 5000);

	try {
		const response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
		clearTimeout(timeout);
		const elapsed = Math.round(performance.now() - start);

		if (!response.ok) {
			return {
				success: false,
				error: `HTTP ${response.status}`,
				responseTimeMs: elapsed,
			};
		}

		const payload = (await response.json()) as { models?: Array<{ name?: unknown }> };
		const models = Array.isArray(payload.models)
			? payload.models.map((m) => m.name).filter((name): name is string => typeof name === "string")
			: [];

		debug.info("Ollama probe OK", { baseUrl, modelCount: models.length });
		return {
			success: true,
			data: { baseUrl, reachable: true, modelCount: models.length, models: models.slice(0, 12) },
			responseTimeMs: elapsed,
		};
	} catch (error) {
		clearTimeout(timeout);
		const elapsed = Math.round(performance.now() - start);
		const message = error instanceof Error ? error.message : String(error);
		debug.error("Ollama probe failed", { baseUrl, error: message });
		return {
			success: false,
			error: message,
			responseTimeMs: elapsed,
		};
	}
}

export function probeKeyboardState(): ProbeResult<KeyboardProbeData> {
	const start = performance.now();
	const data: KeyboardProbeData = {
		platform: process.platform,
		stdinIsTTY: process.stdin.isTTY ?? false,
		stdoutIsTTY: process.stdout.isTTY ?? false,
	};
	debug.info("Keyboard probe OK", data);
	return {
		success: true,
		data,
		responseTimeMs: Math.round(performance.now() - start),
	};
}

export function probeAppState(): ProbeResult<AppStateProbeData> {
	const start = performance.now();
	const data: AppStateProbeData = {
		nodeVersion: process.version,
		platform: process.platform,
		arch: process.arch,
		ollamaBaseUrl: getOllamaBaseUrl(),
	};
	debug.info("App state probe OK", data);
	return {
		success: true,
		data,
		responseTimeMs: Math.round(performance.now() - start),
	};
}

export async function runFullDiagnostic(): Promise<DiagnosticReport> {
	const [ollama, keyboard, appState] = await Promise.all([
		probeOllamaModels(),
		Promise.resolve(probeKeyboardState()),
		Promise.resolve(probeAppState()),
	]);

	const overallHealthy = ollama.success && keyboard.success && appState.success;

	const report: DiagnosticReport = {
		timestamp: new Date().toISOString(),
		probes: { ollama, keyboard, appState },
		overallHealthy,
	};

	debug.info("Diagnostic report", report);
	return report;
}

export function formatDiagnosticReport(report: DiagnosticReport): string {
	const lines: string[] = [];
	lines.push(`[ORPHEUS DIAGNOSTICS] ${report.timestamp}`);
	lines.push(`Overall: ${report.overallHealthy ? "HEALTHY" : "DEGRADED"}`);
	lines.push("");

	const o = report.probes.ollama;
	lines.push(`Ollama  ${o.success ? "OK" : "FAIL"}  ${o.responseTimeMs}ms`);
	if (o.data) {
		lines.push(`  → ${o.data.baseUrl} · ${o.data.modelCount} models`);
		if (o.data.models.length > 0) lines.push(`  → ${o.data.models.join(", ")}`);
	}
	if (o.error) lines.push(`  → ERROR: ${o.error}`);
	lines.push("");

	const k = report.probes.keyboard;
	lines.push(`Keyboard  ${k.success ? "OK" : "FAIL"}  ${k.responseTimeMs}ms`);
	if (k.data) {
		lines.push(
			`  → TTY stdin=${k.data.stdinIsTTY} stdout=${k.data.stdoutIsTTY} platform=${k.data.platform}`
		);
	}
	lines.push("");

	const a = report.probes.appState;
	lines.push(`AppState  ${a.success ? "OK" : "FAIL"}  ${a.responseTimeMs}ms`);
	if (a.data) {
		lines.push(`  → ${a.data.nodeVersion} · ${a.data.platform}/${a.data.arch}`);
		lines.push(`  → Ollama URL: ${a.data.ollamaBaseUrl}`);
	}

	return lines.join("\n");
}
