import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { tool } from "ai";
import { z } from "zod";

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_OUTPUT_LENGTH = 50000;

type SignalAction = "listAccounts" | "listContacts" | "listGroups" | "receive" | "sendMessage";

interface SignalCommandResult {
	success: boolean;
	action: SignalAction;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	json?: unknown;
	error?: string;
}

function getSignalCliBin(): string {
	return process.env.SIGNAL_CLI_BIN?.trim() || "signal-cli";
}

export function resolveSignalCliSpawnCommand(bin = getSignalCliBin()): {
	command: string;
	prefixArgs: string[];
} {
	if (process.platform === "win32" && /\.(?:bat|cmd)$/i.test(bin)) {
		return {
			command: process.env.ComSpec || "cmd.exe",
			prefixArgs: ["/d", "/s", "/c", "call", bin],
		};
	}

	return {
		command: bin,
		prefixArgs: [],
	};
}

function buildBaseArgs(account?: string): string[] {
	const args: string[] = [];
	const configPath = process.env.SIGNAL_CLI_CONFIG?.trim();
	if (configPath) {
		args.push("--config", configPath);
	}
	args.push("-o", "json");
	const effectiveAccount = account?.trim() || process.env.SIGNAL_CLI_ACCOUNT?.trim();
	if (effectiveAccount) {
		args.push("-a", effectiveAccount);
	}
	return args;
}

function parseJsonOutput(stdout: string): unknown {
	const trimmed = stdout.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		const lines = trimmed
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		const parsed: unknown[] = [];
		for (const line of lines) {
			try {
				parsed.push(JSON.parse(line));
			} catch {
				return undefined;
			}
		}
		return parsed;
	}
}

function runSignalCli(
	args: string[],
	stdin?: string,
	timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<{
	exitCode: number | null;
	stdout: string;
	stderr: string;
	error?: string;
}> {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let killed = false;
		const spawnCommand = resolveSignalCliSpawnCommand();

		let proc: ChildProcessWithoutNullStreams;
		try {
			proc = spawn(spawnCommand.command, [...spawnCommand.prefixArgs, ...args], {
				env: process.env,
				shell: false,
				windowsHide: true,
			});
		} catch (error) {
			resolve({
				exitCode: null,
				stdout: "",
				stderr: "",
				error: error instanceof Error ? error.message : String(error),
			});
			return;
		}

		const timeout = setTimeout(() => {
			killed = true;
			proc.kill();
		}, timeoutMs);

		proc.stdout.on("data", (data: Buffer) => {
			stdout += data.toString();
		});

		proc.stderr.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		proc.on("error", (error) => {
			clearTimeout(timeout);
			resolve({
				exitCode: null,
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				error: error instanceof Error ? error.message : String(error),
			});
		});

		proc.on("close", (code) => {
			clearTimeout(timeout);
			if (stdout.length > MAX_OUTPUT_LENGTH)
				stdout = `${stdout.slice(0, MAX_OUTPUT_LENGTH)}\n... [output truncated]`;
			if (stderr.length > MAX_OUTPUT_LENGTH)
				stderr = `${stderr.slice(0, MAX_OUTPUT_LENGTH)}\n... [output truncated]`;
			resolve({
				exitCode: code,
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				error: killed ? `signal-cli timed out after ${timeoutMs}ms` : undefined,
			});
		});

		if (stdin !== undefined) {
			proc.stdin.end(stdin);
		} else {
			proc.stdin.end();
		}
	});
}

function buildActionArgs(input: {
	action: SignalAction;
	account?: string;
	recipient?: string;
	groupId?: string;
	message?: string;
	attachments?: string[];
	timeoutSeconds?: number;
	maxMessages?: number;
	ignoreAttachments?: boolean;
}): { args: string[]; stdin?: string; error?: string } {
	const args = buildBaseArgs(input.account);

	switch (input.action) {
		case "listAccounts":
			args.push("listAccounts");
			return { args };
		case "listContacts":
			args.push("listContacts");
			return { args };
		case "listGroups":
			args.push("listGroups");
			return { args };
		case "receive":
			args.push("receive");
			args.push("--timeout", String(input.timeoutSeconds ?? 1));
			if (typeof input.maxMessages === "number") {
				args.push("--max-messages", String(input.maxMessages));
			}
			if (input.ignoreAttachments ?? true) {
				args.push("--ignore-attachments");
			}
			return { args };
		case "sendMessage": {
			const message = input.message?.trim();
			if (!message) return { args, error: "message is required for sendMessage" };
			if (!input.recipient?.trim() && !input.groupId?.trim()) {
				return { args, error: "recipient or groupId is required for sendMessage" };
			}
			args.push("send", "--message-from-stdin");
			if (input.groupId?.trim()) {
				args.push("--group-id", input.groupId.trim());
			}
			for (const attachment of input.attachments ?? []) {
				if (attachment.trim()) args.push("--attachment", attachment.trim());
			}
			if (input.recipient?.trim()) {
				args.push(input.recipient.trim());
			}
			return { args, stdin: message };
		}
	}
}

export async function detectSignalCli(): Promise<{ available: boolean; reason?: string; version?: string }> {
	const result = await runSignalCli(["--version"], undefined, 5000);
	if (result.exitCode !== 0) {
		return {
			available: false,
			reason: result.error || result.stderr || "signal-cli not found",
		};
	}
	return {
		available: true,
		version: result.stdout || result.stderr || undefined,
	};
}

export const signal = tool({
	description:
		"Use local signal-cli to work with Signal messages. Can list accounts/contacts/groups, receive messages, and send Signal messages. Sending messages always requires user approval.",
	inputSchema: z.object({
		action: z
			.enum(["listAccounts", "listContacts", "listGroups", "receive", "sendMessage"])
			.describe("Signal action to perform."),
		account: z
			.string()
			.optional()
			.describe("Signal account phone number, e.g. +12025550123. Defaults to SIGNAL_CLI_ACCOUNT."),
		recipient: z
			.string()
			.optional()
			.describe("Recipient phone number, UUID, PNI: UUID, or u:username. Required for direct sends."),
		groupId: z.string().optional().describe("Signal group ID for group sends."),
		message: z.string().optional().describe("Message body for sendMessage."),
		attachments: z
			.array(z.string())
			.optional()
			.describe("Local attachment file paths for sendMessage. These files are uploaded to Signal."),
		timeoutSeconds: z.number().int().min(0).max(60).optional().describe("Receive timeout in seconds."),
		maxMessages: z.number().int().min(1).max(100).optional().describe("Maximum messages to receive."),
		ignoreAttachments: z
			.boolean()
			.optional()
			.default(true)
			.describe("For receive, avoid downloading attachments by default."),
	}),
	needsApproval: async ({ action }) => action === "sendMessage",
	execute: async (input): Promise<SignalCommandResult> => {
		const built = buildActionArgs(input);
		if (built.error) {
			return {
				success: false,
				action: input.action,
				exitCode: null,
				stdout: "",
				stderr: "",
				error: built.error,
			};
		}

		const timeoutMs = Math.max(DEFAULT_TIMEOUT_MS, ((input.timeoutSeconds ?? 0) + 10) * 1000);
		const result = await runSignalCli(built.args, built.stdin, timeoutMs);
		const json = parseJsonOutput(result.stdout);
		return {
			success: result.exitCode === 0 && !result.error,
			action: input.action,
			exitCode: result.exitCode,
			stdout: result.stdout,
			stderr: result.stderr,
			json,
			error: result.error,
		};
	},
});
