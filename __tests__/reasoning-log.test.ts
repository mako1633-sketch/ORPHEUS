import { describe, expect, it, beforeEach } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getAppConfigDir } from "../src/utils/preferences";
import {
	appendReasoning,
	readReasoningLog,
	buildReasoningSummary,
} from "../src/utils/reasoning-log";

const REASONING_FILE = "reasoning-trace.jsonl";

async function clearReasoningLog(): Promise<void> {
	try {
		const logPath = path.join(getAppConfigDir(), REASONING_FILE);
		await fs.unlink(logPath);
	} catch {
		// ignore if file doesn't exist
	}
}

describe("reasoning-log", () => {
	beforeEach(async () => {
		await clearReasoningLog();
	});

	it("appends and reads a reasoning entry", async () => {
		const entry = await appendReasoning({
			task: "Test reasoning",
			assumptions: ["Assumption A", "Assumption B"],
			decisions: [{ branch: "Path X", reason: "Faster" }],
			confidence: "high",
			conclusion: "Everything works.",
		});

		expect(entry.id).toMatch(/^r-/);
		expect(entry.timestamp).toBeTruthy();
		expect(entry.task).toBe("Test reasoning");
		expect(entry.confidence).toBe("high");

		const entries = await readReasoningLog(10);
		expect(entries.length).toBe(1);
		expect(entries[0].task).toBe("Test reasoning");
		expect(entries[0].assumptions).toEqual(["Assumption A", "Assumption B"]);
	});

	it("appends multiple entries and reads in reverse order", async () => {
		await appendReasoning({
			task: "First task",
			assumptions: ["Assumption 1"],
			decisions: [{ branch: "A", reason: "Reason 1" }],
			confidence: "medium",
			conclusion: "Result 1",
		});
		await appendReasoning({
			task: "Second task",
			assumptions: ["Assumption 2"],
			decisions: [{ branch: "B", reason: "Reason 2" }],
			confidence: "low",
			conclusion: "Result 2",
		});

		const entries = await readReasoningLog(10);
		expect(entries.length).toBe(2);
		expect(entries[0].task).toBe("Second task");
		expect(entries[1].task).toBe("First task");
	});

	it("respects the limit parameter", async () => {
		for (let i = 0; i < 5; i++) {
			await appendReasoning({
				task: `Task ${i}`,
				assumptions: [],
				decisions: [],
				confidence: "high",
				conclusion: `Result ${i}`,
			});
		}

		const entries = await readReasoningLog(3);
		expect(entries.length).toBe(3);
		expect(entries[0].task).toBe("Task 4");
	});

	it("builds a reasoning summary with task filter", async () => {
		await appendReasoning({
			task: "Flux setup",
			assumptions: ["Repo exists"],
			decisions: [{ branch: "Use bun", reason: "Faster installs" }],
			confidence: "high",
			conclusion: "Setup complete.",
		});
		await appendReasoning({
			task: "D&D campaign mapping",
			assumptions: ["World is medieval"],
			decisions: [{ branch: "Map regions first", reason: "Logical order" }],
			confidence: "medium",
			conclusion: "Map drafted.",
		});

		const summary = await buildReasoningSummary("Flux", 10);
		expect(summary).toContain("Flux setup");
		expect(summary).toContain("reasoning-trace");
		expect(summary).not.toContain("D&D");
	});

	it("builds empty summary when no matching entries", async () => {
		const summary = await buildReasoningSummary("nonexistent", 10);
		expect(summary).toBe("");
	});

	it("handles malformed JSON lines gracefully", async () => {
		const logPath = path.join(getAppConfigDir(), REASONING_FILE);
		await fs.mkdir(path.dirname(logPath), { recursive: true });
		await fs.writeFile(
			logPath,
			'{"task": "valid"}\nthis is not json\n{"task": "also valid"}\n',
			"utf8"
		);

		const entries = await readReasoningLog(10);
		expect(entries.length).toBe(2);
		expect(entries[0].task).toBe("also valid");
		expect(entries[1].task).toBe("valid");
	});
});
