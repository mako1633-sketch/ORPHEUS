/**
 * AI Red Team Scheduler Persistence
 *
 * Persistent storage for scheduled runs so they survive restarts.
 * Uses a JSON-backed file store (or in-memory fallback for tests).
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ScheduledRunConfig } from "./scheduler";

export interface PersistedSchedule {
	version: number;
	updatedAt: string;
	configs: ScheduledRunConfig[];
}

const PERSISTENCE_VERSION = 1;

let persistencePath: string | undefined;
let inMemoryStore: PersistedSchedule = {
	version: PERSISTENCE_VERSION,
	updatedAt: new Date().toISOString(),
	configs: [],
};

/**
 * Set the file path for persistence.
 * If not set, schedules are kept in memory only.
 */
export function setPersistencePath(path: string): void {
	persistencePath = path;
}

function ensureDir(path: string): void {
	const dir = dirname(path);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

/**
 * Save schedules to the persistence store.
 */
export function persistSchedules(configs: ScheduledRunConfig[]): void {
	const data: PersistedSchedule = {
		version: PERSISTENCE_VERSION,
		updatedAt: new Date().toISOString(),
		configs,
	};
	inMemoryStore = data;
	if (persistencePath) {
		try {
			ensureDir(persistencePath);
			writeFileSync(persistencePath, JSON.stringify(data, null, 2), "utf-8");
		} catch {
			// Silently fallback to in-memory only
		}
	}
}

/**
 * Load schedules from the persistence store.
 */
export function loadSchedules(): ScheduledRunConfig[] {
	if (persistencePath && existsSync(persistencePath)) {
		try {
			const raw = readFileSync(persistencePath, "utf-8");
			const parsed = JSON.parse(raw) as PersistedSchedule;
			if (parsed.version === PERSISTENCE_VERSION && Array.isArray(parsed.configs)) {
				inMemoryStore = parsed;
				return parsed.configs;
			}
		} catch {
			// Return in-memory fallback
		}
	}
	return inMemoryStore.configs;
}

/**
 * Check if persistence is configured.
 */
export function isPersistenceEnabled(): boolean {
	return !!persistencePath;
}

/**
 * Clear the in-memory store and remove the file (if set).
 */
export function clearPersistence(): void {
	inMemoryStore = {
		version: PERSISTENCE_VERSION,
		updatedAt: new Date().toISOString(),
		configs: [],
	};
	if (persistencePath) {
		try {
			if (existsSync(persistencePath)) {
				const fs = require("node:fs");
				fs.unlinkSync(persistencePath);
			}
		} catch {
			// ignore
		}
	}
}

/**
 * Utility: hydrate a ScheduleRunner from persisted configs.
 */
import type { ScheduleRunner } from "./scheduler";

export function hydrateScheduleRunner(
	runner: ScheduleRunner,
	clearExisting = false
): ScheduleRunner {
	const configs = loadSchedules();
	if (clearExisting) {
		for (const id of runner.list()) {
			runner.unregister(id);
		}
	}
	for (const config of configs) {
		runner.register(config);
	}
	return runner;
}
