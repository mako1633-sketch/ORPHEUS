/**
 * Debug logger for TUI development.
 * Writes to a file instead of stdout to avoid UI glitches.
 *
 * Usage:
 *   import { debug } from "../utils/debug-logger";
 *   debug.log("message", someObject);
 *
 * Then run `tail -f ~/.config/orpheus/logs/debug.log` in a separate terminal.
 * Tool-specific logging uses `~/.config/orpheus/logs/tools.log`.
 * Message logging uses `~/.config/orpheus/logs/messages.log`.
 * Memory logging uses `~/.config/orpheus/logs/memory.log`.
 */

import fs from "node:fs";
import path from "node:path";
import { getAppConfigDir } from "./preferences";

const LOG_DIR = path.join(getAppConfigDir(), "logs");
const LOG_FILE = path.join(LOG_DIR, "debug.log");
const TOOLS_LOG_FILE = path.join(LOG_DIR, "tools.log");
const MESSAGES_LOG_FILE = path.join(LOG_DIR, "messages.log");
const MEMORY_LOG_FILE = path.join(LOG_DIR, "memory.log");
const ENABLED = process.env.DEBUG_LOG === "1" || process.env.DEBUG_LOG === "true";

const flushIntervalMs = 500;
const bufferByFile = new Map<string, string[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function ensureLogDir(logDir: string): void {
	try {
		fs.mkdirSync(logDir, { recursive: true });
	} catch {}
}

function scheduleFlush(): void {
	if (flushTimer) return;
	flushTimer = setTimeout(flushBuffers, flushIntervalMs);
	flushTimer.unref();
}

function flushBuffers(): void {
	flushTimer = null;
	for (const [logFile, lines] of bufferByFile) {
		if (lines.length === 0) continue;
		const content = lines.join("");
		lines.length = 0;
		try {
			ensureLogDir(LOG_DIR);
			fs.appendFileSync(logFile, content);
		} catch {}
	}
}

function formatValue(value: unknown): string {
	if (value === undefined) return "undefined";
	if (value === null) return "null";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function writeLog(logFile: string, level: string, args: unknown[]): void {
	if (!ENABLED) return;

	const timestamp = new Date().toISOString();
	const formatted = args.map(formatValue).join(" ");
	const line = `[${timestamp}] [${level}] ${formatted}\n`;

	let buffer = bufferByFile.get(logFile);
	if (!buffer) {
		buffer = [];
		bufferByFile.set(logFile, buffer);
	}
	buffer.push(line);
	scheduleFlush();
}

function createDebugLogger(logFile: string) {
	return {
		log: (...args: unknown[]) => writeLog(logFile, "LOG", args),
		info: (...args: unknown[]) => writeLog(logFile, "INFO", args),
		warn: (...args: unknown[]) => writeLog(logFile, "WARN", args),
		error: (...args: unknown[]) => writeLog(logFile, "ERROR", args),

		/** Clear the log file */
		clear: () => {
			if (!ENABLED) return;
			flushBuffers();
			try {
				ensureLogDir(LOG_DIR);
				fs.writeFileSync(logFile, "");
			} catch {}
		},
	};
}

export const debug = createDebugLogger(LOG_FILE);
export const toolDebug = createDebugLogger(TOOLS_LOG_FILE);
export const messageDebug = createDebugLogger(MESSAGES_LOG_FILE);
export const memoryDebug = createDebugLogger(MEMORY_LOG_FILE);
