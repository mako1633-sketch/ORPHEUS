export type CliAction =
	| { kind: "help" }
	| { kind: "version" }
	| { kind: "launch"; tuiArgs: string[] }
	| { kind: "error"; message: string };

export function parseCliArgs(args: string[]): CliAction {
	if (args.length === 0) {
		return { kind: "launch", tuiArgs: [] };
	}

	if (args.includes("--version") || args.includes("-v")) {
		return { kind: "version" };
	}

	if (args.includes("--help") || args.includes("-h")) {
		return { kind: "help" };
	}

	const [command, ...rest] = args;

	if (command === "tui" || command === "run") {
		return { kind: "launch", tuiArgs: rest };
	}

	if (command?.startsWith("-")) {
		return { kind: "error", message: `Unknown option: ${command}` };
	}

	return { kind: "error", message: `Unknown command: ${command}` };
}

export function formatCliHelp(version: string): string {
	return [
		`ORPHEUS ${version}`,
		"",
		"Usage:",
		"  orpheus              Launch the terminal UI",
		"  orpheus tui [args]   Launch the terminal UI and pass args through",
		"  orpheus run [args]   Alias for tui",
		"  orpheus --version    Print version",
		"  orpheus --help       Show this help",
	].join("\n");
}
