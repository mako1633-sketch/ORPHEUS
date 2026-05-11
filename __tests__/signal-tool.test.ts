import { describe, expect, it } from "bun:test";
import { resolveSignalCliSpawnCommand } from "../src/ai/tools/signal";

describe("signal tool", () => {
	it("routes Windows batch wrappers through cmd.exe", () => {
		const resolved = resolveSignalCliSpawnCommand("E:\\signal-cli\\bin\\signal-cli.bat");

		if (process.platform === "win32") {
			expect(resolved.command.toLowerCase()).toContain("cmd");
			expect(resolved.prefixArgs).toContain("call");
			expect(resolved.prefixArgs).toContain("E:\\signal-cli\\bin\\signal-cli.bat");
		} else {
			expect(resolved.command).toBe("E:\\signal-cli\\bin\\signal-cli.bat");
			expect(resolved.prefixArgs).toEqual([]);
		}
	});

	it("spawns native signal-cli binaries directly", () => {
		const resolved = resolveSignalCliSpawnCommand("signal-cli");

		expect(resolved.command).toBe("signal-cli");
		expect(resolved.prefixArgs).toEqual([]);
	});
});
