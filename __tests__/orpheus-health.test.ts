import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	buildOrpheusHealthSnapshot,
	clearOrpheusHealthCacheForTesting,
	formatHealthSnapshot,
} from "../src/health/orpheus-health";

const ORIGINAL_ENV = { ...process.env };

describe("ORPHEUS health", () => {
	beforeEach(() => {
		process.env = { ...ORIGINAL_ENV };
		clearOrpheusHealthCacheForTesting();
	});

	afterEach(() => {
		process.env = { ...ORIGINAL_ENV };
		clearOrpheusHealthCacheForTesting();
	});

	it("reports a compact health snapshot with core checks", async () => {
		const snapshot = await buildOrpheusHealthSnapshot();

		expect(snapshot.checks.map((check) => check.id)).toEqual([
			"model",
			"tools",
			"memory",
			"shell",
			"search",
			"session",
		]);
		expect(snapshot.label).toContain(snapshot.level.toUpperCase());
		expect(snapshot.updatedAt).toBeGreaterThan(0);
	});

	it("does not mark optional missing tools as an outage when a model route works", async () => {
		process.env.OPENROUTER_API_KEY = "sk-or-test";

		const snapshot = await buildOrpheusHealthSnapshot();
		const modelCheck = snapshot.checks.find((check) => check.id === "model");
		const toolsCheck = snapshot.checks.find((check) => check.id === "tools");

		expect(modelCheck?.level).toBe("ok");
		expect(toolsCheck?.level).toBe("ok");
		expect(snapshot.label).not.toContain("TOOLS");
	});

	it("treats Honcho as a valid memory route", async () => {
		process.env.HONCHO_ENABLED = "true";

		const snapshot = await buildOrpheusHealthSnapshot();
		const memoryCheck = snapshot.checks.find((check) => check.id === "memory");

		expect(memoryCheck?.level).toBe("ok");
		expect(memoryCheck?.summary).toContain("Honcho");
	});

	it("detects contaminated session history as repairable", async () => {
		const snapshot = await buildOrpheusHealthSnapshot({
			conversationHistory: [
				{
					id: 1,
					type: "daemon",
					content:
						"I hit a routing glitch and blocked an invalid internal action before it reached the system.",
					messages: [],
				},
			],
		});

		const sessionCheck = snapshot.checks.find((check) => check.id === "session");
		expect(sessionCheck?.level).toBe("repair");
		expect(sessionCheck?.summary).toContain("contaminated turn");
		expect(formatHealthSnapshot(snapshot)).toContain("[REPAIR] Session");
	});
});
