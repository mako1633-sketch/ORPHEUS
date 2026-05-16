import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";
import { getOllamaBaseUrl } from "../model-config";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 3000;

export interface SystemStatusResult {
	success: boolean;
	platform: NodeJS.Platform;
	hostname: string;
	uptimeSeconds: number;
	cpu: {
		model: string;
		cores: number;
		loadAverage: number[];
	};
	memory: {
		totalBytes: number;
		freeBytes: number;
		usedPercent: number;
	};
	disk?: {
		path: string;
		totalBytes: number;
		availableBytes: number;
		usedPercent: number;
	};
	battery?: {
		percent?: number;
		state?: string;
		detail?: string;
	};
	ollama?: {
		baseUrl: string;
		reachable: boolean;
		modelCount?: number;
		models?: string[];
		error?: string;
	};
	error?: string;
}

function bytesFromKilobytes(value: string): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed * 1024 : 0;
}

async function getDiskStatus(targetPath = process.cwd()): Promise<SystemStatusResult["disk"]> {
	const pathToCheck = existsSync(targetPath) ? targetPath : process.cwd();
	const stats = statSync(pathToCheck);
	const diskPath = stats.isDirectory() ? pathToCheck : process.cwd();

	if (process.platform === "win32") {
		return { path: diskPath, totalBytes: 0, availableBytes: 0, usedPercent: 0 };
	}

	const { stdout } = await execFileAsync("df", ["-k", diskPath], { timeout: COMMAND_TIMEOUT_MS });
	const lines = stdout.trim().split("\n");
	const data = lines[1]?.trim().split(/\s+/);
	if (!data || data.length < 6) return undefined;

	const totalBytes = bytesFromKilobytes(data[1] ?? "0");
	const availableBytes = bytesFromKilobytes(data[3] ?? "0");
	const usedText = data[4] ?? "0%";
	const usedPercent = Number(usedText.replace("%", ""));

	return {
		path: data[5] ?? diskPath,
		totalBytes,
		availableBytes,
		usedPercent: Number.isFinite(usedPercent) ? usedPercent : 0,
	};
}

async function getMacBatteryStatus(): Promise<SystemStatusResult["battery"]> {
	if (process.platform !== "darwin") return undefined;

	try {
		const { stdout } = await execFileAsync("pmset", ["-g", "batt"], {
			timeout: COMMAND_TIMEOUT_MS,
		});
		const percentMatch = stdout.match(/(\d+)%/);
		const stateMatch = stdout.match(/;\s*([^;]+);/);
		return {
			percent: percentMatch ? Number(percentMatch[1]) : undefined,
			state: stateMatch?.[1]?.trim(),
			detail: stdout.trim().replace(/\s+/g, " "),
		};
	} catch {
		return undefined;
	}
}

async function getOllamaStatus(): Promise<SystemStatusResult["ollama"]> {
	const baseUrl = getOllamaBaseUrl().replace(/\/v1$/, "");
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS);

	try {
		const response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
		if (!response.ok) {
			return { baseUrl, reachable: false, error: `HTTP ${response.status}` };
		}

		const payload = (await response.json()) as { models?: Array<{ name?: unknown }> };
		const models = Array.isArray(payload.models)
			? payload.models
					.map((model) => model.name)
					.filter((name): name is string => typeof name === "string")
			: [];

		return {
			baseUrl,
			reachable: true,
			modelCount: models.length,
			models: models.slice(0, 8),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { baseUrl, reachable: false, error: message };
	} finally {
		clearTimeout(timeout);
	}
}

export async function collectSystemStatus(): Promise<SystemStatusResult> {
	const totalMemory = os.totalmem();
	const freeMemory = os.freemem();
	const usedPercent =
		totalMemory > 0 ? Math.round(((totalMemory - freeMemory) / totalMemory) * 100) : 0;

	const result: SystemStatusResult = {
		success: true,
		platform: process.platform,
		hostname: os.hostname(),
		uptimeSeconds: os.uptime(),
		cpu: {
			model: os.cpus()[0]?.model ?? "Unknown CPU",
			cores: os.cpus().length,
			loadAverage: os.loadavg(),
		},
		memory: {
			totalBytes: totalMemory,
			freeBytes: freeMemory,
			usedPercent,
		},
		disk: await getDiskStatus().catch(() => undefined),
		battery: await getMacBatteryStatus(),
		ollama: await getOllamaStatus(),
	};

	return result;
}

export const systemStatus = tool({
	description:
		"Get a local system status summary: CPU, memory, disk, uptime, macOS battery when available, and Ollama endpoint/model availability.",
	inputSchema: z.object({
		scope: z
			.enum(["summary"])
			.default("summary")
			.describe("Status scope. Currently only summary is supported."),
	}),
	execute: collectSystemStatus,
});
