/**
 * Crash-Resistant State Machine (WAL-style)
 * Guarantees that any state write is atomic and recoverable across crashes.
 * Every write goes to a .tmp file, is fsynced, then atomically renamed.
 * On load, orphaned .tmp files indicate interrupted writes and are auto-recovered.
 */

import { promises as fs, type Stats } from "node:fs";
import path from "node:path";
import { debug } from "../utils/debug-logger";

const WAL_EXTENSION = ".wal.tmp";

/** Atomic write: write to temp, fsync, rename */
export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
	const tmpPath = `${filePath}${WAL_EXTENSION}`;
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(tmpPath, data, "utf8");
	// fsync the temp file contents
	const fd = await fs.open(tmpPath, "r+");
	try {
		await fd.sync();
	} finally {
		await fd.close();
	}
	// Atomic rename
	await fs.rename(tmpPath, filePath);
	// fsync the directory to guarantee rename durability
	const dirFd = await fs.open(path.dirname(filePath), "r");
	try {
		await dirFd.sync();
	} finally {
		await dirFd.close();
	}
}

/** Recover from an interrupted atomic write */
export async function recoverAtomicWrite(filePath: string): Promise<boolean> {
	const tmpPath = `${filePath}${WAL_EXTENSION}`;
	try {
		await fs.access(tmpPath);
	} catch {
		return false; // no orphaned temp file
	}
	try {
		const tmpStat = await fs.stat(tmpPath);
		let targetStat: Stats | null = null;
		try {
			targetStat = await fs.stat(filePath);
		} catch {
			// target doesn't exist
		}
		if (!targetStat || tmpStat.mtimeMs > targetStat.mtimeMs) {
			await fs.rename(tmpPath, filePath);
			debug.info("crash-recovery", { message: `Recovered ${path.basename(filePath)} from WAL` });
			return true;
		}
		// Target is newer — the temp is stale, delete it
		await fs.rm(tmpPath, { force: true });
		return false;
	} catch (error) {
		debug.error("crash-recovery", {
			message: `Recovery failed for ${path.basename(filePath)}`,
			error: error instanceof Error ? error.message : String(error),
		});
		return false;
	}
}

/** Safe read with automatic recovery */
export async function safeReadFile(
	filePath: string,
	encoding: BufferEncoding = "utf8"
): Promise<string | null> {
	await recoverAtomicWrite(filePath);
	try {
		return await fs.readFile(filePath, encoding);
	} catch {
		return null;
	}
}

/** Serialize state with a version header for forward compatibility */
export function serializeState<T>(state: T, version = 1): string {
	return JSON.stringify({ _v: version, _t: Date.now(), state }, null, 2);
}

/** Deserialize state, ignoring version header */
export function deserializeState<T>(raw: string): T | null {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && "state" in parsed) {
			return (parsed as { state: T }).state;
		}
		return parsed as T;
	} catch {
		return null;
	}
}

/** Wrap an existing JSON file path with WAL guarantees */
export async function persistState<T>(
	filePath: string,
	state: T,
	version = 1
): Promise<{ path: string; success: boolean }> {
	try {
		await atomicWriteFile(filePath, serializeState(state, version));
		return { path: filePath, success: true };
	} catch (error) {
		debug.error("persist-state", {
			message: `Failed to persist ${path.basename(filePath)}`,
			error: error instanceof Error ? error.message : String(error),
		});
		return { path: filePath, success: false };
	}
}

export async function loadState<T>(filePath: string): Promise<T | null> {
	const raw = await safeReadFile(filePath);
	if (!raw) return null;
	return deserializeState<T>(raw);
}
