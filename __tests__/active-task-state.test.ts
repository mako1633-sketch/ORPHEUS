import { afterEach, describe, expect, it } from "bun:test";
import {
	buildActiveTaskContext,
	clearActiveTaskState,
	getActiveTaskState,
	setActiveTaskState,
} from "../src/ai/active-task-state";

describe("active task state", () => {
	afterEach(() => {
		clearActiveTaskState();
	});

	it("stores compact active task continuity context", () => {
		setActiveTaskState({
			kind: "windows-assessment",
			summary: "Running quick posture assessment",
			nextStep: "Parse findings",
		});

		expect(getActiveTaskState()?.kind).toBe("windows-assessment");
		expect(buildActiveTaskContext()).toContain("Running quick posture assessment");
		expect(buildActiveTaskContext()).toContain("Parse findings");
	});
});
