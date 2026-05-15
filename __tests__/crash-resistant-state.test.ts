import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	atomicWriteFile,
	deserializeState,
	loadState,
	persistState,
	recoverAtomicWrite,
	safeReadFile,
	serializeState,
} from "../src/ai/crash-resistant-state";

describe("crash-resistant state", () => {
	const testDir = path.join(tmpdir(), `orpheus-wal-test-${Date.now()}`);

	test("atomicWriteFile writes readable content", async () => {
		const filePath = path.join(testDir, "test.json");
		await atomicWriteFile(filePath, '{"hello":"world"}');
		const content = await fs.readFile(filePath, "utf8");
		expect(content).toBe('{"hello":"world"}');
		await fs.rm(testDir, { recursive: true, force: true });
	});

	test("recoverAtomicWrite recovers orphaned temp file", async () => {
		const filePath = path.join(testDir, "recover.json");
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(`${filePath}.wal.tmp`, "recovered-data", "utf8");
		const recovered = await recoverAtomicWrite(filePath);
		expect(recovered).toBe(true);
		const content = await fs.readFile(filePath, "utf8");
		expect(content).toBe("recovered-data");
		await fs.rm(testDir, { recursive: true, force: true });
	});

	test("safeReadFile returns null for missing file", async () => {
		const result = await safeReadFile(path.join(testDir, "missing.json"));
		expect(result).toBeNull();
	});

	test("serializeState and deserializeState roundtrip", () => {
		const state = { items: [1, 2, 3], name: "test" };
		const serialized = serializeState(state, 2);
		expect(serialized).toContain('"_v": 2');
		expect(serialized).toContain('"_t"');
		const deserialized = deserializeState<{ items: number[]; name: string }>(serialized);
		expect(deserialized).toEqual(state);
	});

	test("deserializeState handles plain JSON", () => {
		const result = deserializeState<string>('"plain"');
		expect(result).toBe("plain");
	});

	test("persistState and loadState roundtrip", async () => {
		const filePath = path.join(testDir, "persist.json");
		await fs.mkdir(testDir, { recursive: true });
		const state = { updatedAt: new Date().toISOString(), count: 42 };
		const saved = await persistState(filePath, state, 1);
		expect(saved.success).toBe(true);
		const loaded = await loadState<{ updatedAt: string; count: number }>(filePath);
		expect(loaded).toEqual(state);
		await fs.rm(testDir, { recursive: true, force: true });
	});
});
