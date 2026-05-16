import { describe, expect, it } from "bun:test";
import {
	runDirectDaemonDoctor,
	shouldRunDirectDaemonDoctor,
} from "../src/ai/direct-daemon-doctor-runner";
import type { StreamCallbacks } from "../src/types";

describe("direct ORPHEUS doctor runner", () => {
	it("routes doctor setup prompts to deterministic status execution", () => {
		expect(
			shouldRunDirectDaemonDoctor("Run ORPHEUS doctor: keys, tools, PowerShell, Signal, search")
		).toBe(true);
		expect(
			shouldRunDirectDaemonDoctor("Run DAEMON doctor: keys, tools, PowerShell, Signal, search")
		).toBe(true);
		expect(shouldRunDirectDaemonDoctor("Tell me a joke")).toBe(false);
	});

	it("emits a daemonStatus tool call and result", async () => {
		const events: string[] = [];
		const callbacks: StreamCallbacks = {
			onToolCall: (toolName, input) => {
				events.push(`tool:${toolName}`);
				expect(input).toEqual({ scope: "all" });
			},
			onToolResult: (toolName, result) => {
				events.push(`result:${toolName}`);
				expect(result).toHaveProperty("success", true);
			},
		};

		await runDirectDaemonDoctor(callbacks);

		expect(events).toEqual(["tool:daemonStatus", "result:daemonStatus"]);
	});
});
