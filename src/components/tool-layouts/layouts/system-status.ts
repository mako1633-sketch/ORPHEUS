import { registerToolLayout } from "../registry";
import type { ToolBody, ToolLayoutConfig } from "../types";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatBytes(value: unknown): string {
	if (typeof value !== "number" || !Number.isFinite(value)) return "--";
	const units = ["B", "KB", "MB", "GB", "TB"];
	let current = value;
	let idx = 0;
	while (current >= 1024 && idx < units.length - 1) {
		current /= 1024;
		idx += 1;
	}
	const digits = current >= 10 || idx === 0 ? 0 : 1;
	return `${current.toFixed(digits)} ${units[idx]}`;
}

function formatUptime(seconds: unknown): string {
	if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "--";
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (hours <= 0) return `${minutes}m`;
	return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function formatResult(result: unknown): string[] | null {
	if (!isRecord(result)) return null;
	if (result.success === false && typeof result.error === "string") return [`error: ${result.error}`];

	const memory = isRecord(result.memory) ? result.memory : {};
	const cpu = isRecord(result.cpu) ? result.cpu : {};
	const disk = isRecord(result.disk) ? result.disk : null;
	const battery = isRecord(result.battery) ? result.battery : null;
	const ollama = isRecord(result.ollama) ? result.ollama : null;

	const lines = [
		`host: ${typeof result.hostname === "string" ? result.hostname : "--"} · ${String(result.platform ?? "--")} · uptime ${formatUptime(result.uptimeSeconds)}`,
		`cpu: ${String(cpu.cores ?? "--")} cores · load ${(Array.isArray(cpu.loadAverage) ? cpu.loadAverage : [])
			.slice(0, 3)
			.map((v) => (typeof v === "number" ? v.toFixed(2) : String(v)))
			.join(", ")}`,
		`memory: ${String(memory.usedPercent ?? "--")}% used · ${formatBytes(memory.freeBytes)} free of ${formatBytes(memory.totalBytes)}`,
	];

	if (disk) {
		lines.push(
			`disk: ${String(disk.usedPercent ?? "--")}% used · ${formatBytes(disk.availableBytes)} free at ${String(disk.path ?? "--")}`
		);
	}
	if (battery) {
		lines.push(`battery: ${String(battery.percent ?? "--")}% · ${String(battery.state ?? "unknown")}`);
	}
	if (ollama) {
		const reachable = ollama.reachable === true ? "reachable" : "unreachable";
		const count = typeof ollama.modelCount === "number" ? ` · ${ollama.modelCount} models` : "";
		lines.push(`ollama: ${reachable}${count} · ${String(ollama.baseUrl ?? "--")}`);
	}

	return lines;
}

export const systemStatusLayout: ToolLayoutConfig = {
	abbreviation: "sys",
	getHeader: (): { primary: string } => ({ primary: "local status" }),
	getBody: (): ToolBody => ({
		lines: [{ text: "Collecting CPU, memory, disk, battery, and Ollama status" }],
	}),
	formatResult,
};

registerToolLayout("systemStatus", systemStatusLayout);
