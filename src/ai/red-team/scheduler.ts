/**
 * AI Red Team Scheduled Runner
 *
 * Cron-like recurring probe execution with history tracking,
 * drift detection, and configurable callbacks.
 */

import { persistSchedules, loadSchedules } from "./scheduler-persistence";

export interface ScheduleExpression {
	/** Minutes (0-59) */
	minute?: number;
	/** Hours (0-23) */
	hour?: number;
	/** Day of month (1-31) */
	dayOfMonth?: number;
	/** Day of week (0-6, Sunday = 0) */
	dayOfWeek?: number;
	/** Month (1-12) */
	month?: number;
	/** Interval in ms (alternative to cron fields) */
	intervalMs?: number;
}

export interface ScheduledRunConfig {
	id: string;
	name: string;
	schedule: ScheduleExpression;
	/** Probe IDs to run */
	probeIds: string[];
	/** Target model name */
	targetName: string;
	/** Batch config overrides */
	concurrency?: number;
	requestDelayMs?: number;
	probeTimeoutMs?: number;
	batchTimeoutMs?: number;
	/** Max runs to keep in history */
	maxHistory?: number;
	/** Auto-start on creation */
	autoStart?: boolean;
}

export interface ScheduledRunResult {
	id: string;
	name: string;
	probeIds: string[];
	targetName: string;
	startedAt: string;
	finishedAt?: string;
	status: "running" | "completed" | "failed" | "cancelled";
	summary?: string;
	riskScore?: number;
	error?: string;
}

export interface ScheduledRunHistory {
	config: ScheduledRunConfig;
	results: ScheduledRunResult[];
	nextRunAt?: string;
	lastRunAt?: string;
	totalRuns: number;
	isRunning: boolean;
}

type RunCallback = (result: ScheduledRunResult) => void | Promise<void>;

/**
 * Parse a simplified cron-like string: "* * * * *" or "0 9 * * 1".
 * Format: minute hour dayOfMonth month dayOfWeek
 */
export function parseScheduleExpression(expr: string): ScheduleExpression {
	const parts = expr.trim().split(/\s+/);
	if (parts.length !== 5) {
		throw new Error(
			`Invalid schedule expression "${expr}". Expected 5 fields: min hour dom mon dow`
		);
	}
	const parseField = (s: string, max: number): number | undefined => {
		if (s === "*") return undefined;
		const n = Number.parseInt(s, 10);
		if (Number.isNaN(n) || n < 0 || n > max) {
			throw new Error(`Invalid schedule field "${s}"`);
		}
		return n;
	};
	return {
		minute: parseField(parts[0]!, 59),
		hour: parseField(parts[1]!, 23),
		dayOfMonth: parseField(parts[2]!, 31),
		month: parseField(parts[3]!, 12),
		dayOfWeek: parseField(parts[4]!, 6),
	};
}

function matchesSchedule(date: Date, schedule: ScheduleExpression): boolean {
	if (schedule.intervalMs !== undefined) return true; // handled separately
	if (schedule.minute !== undefined && date.getMinutes() !== schedule.minute) return false;
	if (schedule.hour !== undefined && date.getHours() !== schedule.hour) return false;
	if (schedule.dayOfMonth !== undefined && date.getDate() !== schedule.dayOfMonth) return false;
	if (schedule.month !== undefined && date.getMonth() + 1 !== schedule.month) return false;
	if (schedule.dayOfWeek !== undefined && date.getDay() !== schedule.dayOfWeek) return false;
	return true;
}

function nextRunDelay(schedule: ScheduleExpression): number {
	if (schedule.intervalMs !== undefined) {
		return schedule.intervalMs;
	}
	const now = new Date();
	let next = new Date(now.getTime() + 60_000); // start checking from next minute
	next.setSeconds(0);
	next.setMilliseconds(0);

	// Simple brute-force search within next 366 days
	for (let i = 0; i < 366 * 24 * 60; i++) {
		if (matchesSchedule(next, schedule)) {
			const delay = next.getTime() - now.getTime();
			return delay > 0 ? delay : 60_000;
		}
		next = new Date(next.getTime() + 60_000);
	}
	return 60_000; // fallback
}

export class ScheduleRunner {
	private configs = new Map<string, ScheduledRunConfig>();
	private histories = new Map<string, ScheduledRunHistory>();
	private timers = new Map<string, ReturnType<typeof setTimeout>>();
	private runCallbacks: RunCallback[] = [];
	private activeRuns = new Set<string>();
	private enablePersistence = false;

	constructor(options?: { enablePersistence?: boolean }) {
		this.enablePersistence = options?.enablePersistence ?? false;
		if (this.enablePersistence) {
			this.hydrateFromDisk();
		}
	}

	/**
	 * Enable or disable persistence at runtime.
	 */
	setPersistence(enabled: boolean): void {
		this.enablePersistence = enabled;
		if (enabled) {
			this.saveToDisk();
		}
	}

	private hydrateFromDisk(): void {
		const configs = loadSchedules();
		for (const config of configs) {
			// Do not auto-start on hydration to avoid duplicate timers
			this.configs.set(config.id, config);
			if (!this.histories.has(config.id)) {
				this.histories.set(config.id, {
					config,
					results: [],
					totalRuns: 0,
					isRunning: false,
				});
			}
		}
	}

	private saveToDisk(): void {
		if (this.enablePersistence) {
			persistSchedules(Array.from(this.configs.values()));
		}
	}

	/**
	 * Register a scheduled run configuration.
	 */
	register(config: ScheduledRunConfig): void {
		this.configs.set(config.id, config);
		if (!this.histories.has(config.id)) {
			this.histories.set(config.id, {
				config,
				results: [],
				totalRuns: 0,
				isRunning: false,
			});
		}
		if (config.autoStart !== false) {
			this.start(config.id);
		}
		this.saveToDisk();
	}

	/**
	 * Unregister and stop a scheduled run.
	 */
	unregister(id: string): void {
		this.stop(id);
		this.configs.delete(id);
		this.histories.delete(id);
		this.saveToDisk();
	}

	/**
	 * Start (or restart) the timer for a scheduled run.
	 */
	start(id: string): void {
		this.stop(id);
		const config = this.configs.get(id);
		if (!config) return;

		const tick = () => {
			this.execute(id).catch(() => {});
		};

		const delay = nextRunDelay(config.schedule);
		const timer = setTimeout(() => {
			tick();
			// Re-arm for next occurrence if interval-based
			if (config.schedule.intervalMs !== undefined) {
				const intervalTimer = setInterval(() => {
					if (!this.configs.has(id)) {
						clearInterval(intervalTimer);
						return;
					}
					tick();
				}, config.schedule.intervalMs);
				this.timers.set(id, intervalTimer as unknown as ReturnType<typeof setTimeout>);
			}
		}, delay);

		this.timers.set(id, timer);
		const history = this.histories.get(id);
		if (history) {
			history.nextRunAt = new Date(Date.now() + delay).toISOString();
		}
	}

	/**
	 * Stop the timer for a scheduled run.
	 */
	stop(id: string): void {
		const timer = this.timers.get(id);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(id);
		}
		const history = this.histories.get(id);
		if (history) {
			history.nextRunAt = undefined;
		}
	}

	/**
	 * Execute a run immediately (does not affect schedule).
	 */
	async execute(id: string): Promise<ScheduledRunResult> {
		const config = this.configs.get(id);
		if (!config) {
			throw new Error(`Scheduled run "${id}" not found`);
		}
		if (this.activeRuns.has(id)) {
			throw new Error(`Scheduled run "${id}" is already running`);
		}

		this.activeRuns.add(id);
		const history = this.histories.get(id)!;
		history.isRunning = true;

		const result: ScheduledRunResult = {
			id,
			name: config.name,
			probeIds: config.probeIds,
			targetName: config.targetName,
			startedAt: new Date().toISOString(),
			status: "running",
		};

		try {
			// The actual execution is delegated to the caller via callback.
			// We fire the callback and let the external executor fill in summary/riskScore.
			for (const cb of this.runCallbacks) {
				await cb(result);
			}
			result.status = "completed";
			result.finishedAt = new Date().toISOString();
		} catch (e) {
			result.status = "failed";
			result.error = e instanceof Error ? e.message : String(e);
			result.finishedAt = new Date().toISOString();
		} finally {
			this.activeRuns.delete(id);
			history.isRunning = false;
			history.results.push(result);
			history.totalRuns++;
			history.lastRunAt = result.finishedAt ?? result.startedAt;

			const maxHistory = config.maxHistory ?? 50;
			if (history.results.length > maxHistory) {
				history.results = history.results.slice(-maxHistory);
			}

			// Re-arm for next cron run if not interval-based
			if (config.schedule.intervalMs === undefined) {
				this.start(id);
			}
		}

		return result;
	}

	/**
	 * Register a callback invoked for each scheduled run.
	 * The callback receives a mutable result object and should update
	 * summary / riskScore / status after executing probes.
	 */
	onRun(callback: RunCallback): void {
		this.runCallbacks.push(callback);
	}

	/**
	 * Return true when scheduled executions have a registered probe executor.
	 */
	hasRunCallbacks(): boolean {
		return this.runCallbacks.length > 0;
	}

	/**
	 * Get history for a scheduled run.
	 */
	getHistory(id: string): ScheduledRunHistory | undefined {
		return this.histories.get(id);
	}

	/**
	 * List all registered scheduled run IDs.
	 */
	list(): string[] {
		return Array.from(this.configs.keys());
	}

	/**
	 * Pause all scheduled runs.
	 */
	pauseAll(): void {
		for (const id of this.configs.keys()) {
			this.stop(id);
		}
	}

	/**
	 * Resume all scheduled runs.
	 */
	resumeAll(): void {
		for (const id of this.configs.keys()) {
			this.start(id);
		}
	}

	/**
	 * Dispose all timers and clear state.
	 * Does NOT clear persisted schedules on disk.
	 */
	dispose(): void {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();
		this.configs.clear();
		this.histories.clear();
		this.activeRuns.clear();
		this.runCallbacks = [];
	}

	/**
	 * Clear all state AND remove persisted schedules.
	 */
	async clearAll(): Promise<void> {
		this.dispose();
		if (this.enablePersistence) {
			const { clearPersistence } = await import("./scheduler-persistence");
			clearPersistence();
		}
	}
}

/**
 * Factory: create a ScheduleRunner and optionally register configs.
 */
export function createScheduledRunner(
	configs?: ScheduledRunConfig[],
	opts?: { enablePersistence?: boolean }
): ScheduleRunner {
	const runner = new ScheduleRunner(opts);
	if (configs) {
		for (const c of configs) {
			runner.register(c);
		}
	}
	return runner;
}
