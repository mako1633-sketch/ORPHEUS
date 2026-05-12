import { describe, expect, test } from "bun:test";
import { formatCliHelp, parseCliArgs } from "../src/cli-args";

describe("CLI argument parsing", () => {
	test("launches the TUI by default", () => {
		expect(parseCliArgs([])).toEqual({ kind: "launch", tuiArgs: [] });
	});

	test("handles help and version without launching the TUI", () => {
		expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
		expect(parseCliArgs(["-h"])).toEqual({ kind: "help" });
		expect(parseCliArgs(["--version"])).toEqual({ kind: "version" });
		expect(parseCliArgs(["-v"])).toEqual({ kind: "version" });
	});

	test("passes explicit TUI arguments through", () => {
		expect(parseCliArgs(["tui", "--debug"])).toEqual({ kind: "launch", tuiArgs: ["--debug"] });
		expect(parseCliArgs(["run", "--debug"])).toEqual({ kind: "launch", tuiArgs: ["--debug"] });
	});

	test("rejects unknown commands and options before startup", () => {
		expect(parseCliArgs(["doctor"])).toEqual({ kind: "error", message: "Unknown command: doctor" });
		expect(parseCliArgs(["--bad"])).toEqual({ kind: "error", message: "Unknown option: --bad" });
	});

	test("documents supported commands", () => {
		const help = formatCliHelp("0.13.0");

		expect(help).toContain("ORPHEUS 0.13.0");
		expect(help).toContain("orpheus tui [args]");
		expect(help).toContain("orpheus run [args]");
	});
});
