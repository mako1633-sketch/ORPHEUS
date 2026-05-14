import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";

const SENSITIVE_PATH_SEGMENTS = [
	"/.ssh",
	"/.gnupg",
	"/.gpg",
	"/.aws",
	"/.azure",
	"/.kube",
	"/.docker",
	"/.config/gcloud",
	"/.config/gh",
	"/.config/hub",
	"/.local/share/keyrings",
	"/.password-store",
	"/Library/Keychains",
	"/Windows/System32/config",
	"/AppData/Roaming/Microsoft/Credentials",
	"/AppData/Local/Microsoft/Credentials",
];

const SENSITIVE_FILE_PATTERNS = [
	/id_rsa/i,
	/id_ed25519/i,
	/id_ecdsa/i,
	/id_dsa/i,
	/\.pem$/i,
	/\.key$/i,
	/\.env$/i,
	/\.envrc$/i,
	/\.netrc$/i,
	/\.npmrc$/i,
	/\.pypirc$/i,
	/\.gem\/credentials/i,
	/authorized_keys/i,
	/known_hosts/i,
	/aws.*credentials/i,
	/credentials\.json$/i,
	/NTUSER\.DAT$/i,
	/\bSAM$/i,
	/\bSECURITY$/i,
	/\bSYSTEM$/i,
];

function isPathSensitive(resolvedPath: string): boolean {
	const normalized = resolvedPath.replace(/\\/g, "/");
	const home = homedir().replace(/\\/g, "/");

	if (normalized === home || normalized === home + "/") {
		return true;
	}

	for (const segment of SENSITIVE_PATH_SEGMENTS) {
		if (normalized.includes(segment)) {
			return true;
		}
	}

	const basename = path.basename(resolvedPath);
	for (const pattern of SENSITIVE_FILE_PATTERNS) {
		if (pattern.test(basename)) {
			return true;
		}
	}

	return false;
}

export const writeFile = tool({
	description:
		"Write content to a file. Creates the file if it doesn't exist, or overwrites it if it does. Supports append mode to add content to existing files. Use this to create scripts, save outputs, write configuration files, or generate any text-based file.",
	inputSchema: z.object({
		path: z
			.string()
			.describe("Path to the file to write. Can be absolute or relative to the current working directory."),
		content: z.string().describe("The content to write to the file."),
		append: z
			.boolean()
			.optional()
			.default(false)
			.describe("If true, append to the file instead of overwriting. Creates the file if it doesn't exist."),
	}),
	needsApproval: async ({ path: filePath }) => {
		const resolvedPath = path.resolve(filePath);
		return isPathSensitive(resolvedPath);
	},
	execute: async ({ path: filePath, content, append }) => {
		try {
			const resolvedPath = path.resolve(filePath);
			const dir = path.dirname(resolvedPath);

			// Create parent directories if they don't exist
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			// Write or append to the file
			if (append) {
				fs.appendFileSync(resolvedPath, content, "utf8");
			} else {
				fs.writeFileSync(resolvedPath, content, "utf8");
			}

			const after = fs.readFileSync(resolvedPath, "utf8");
			const verified = append ? after.endsWith(content) : after === content;

			return {
				success: verified,
				path: resolvedPath,
				bytesWritten: Buffer.byteLength(content, "utf8"),
				verified,
				error: verified
					? undefined
					: "Write completed but readback verification did not match requested content.",
			};
		} catch (error: unknown) {
			const err = error instanceof Error ? error : new Error(String(error));
			return {
				success: false,
				path: filePath,
				error: err.message,
			};
		}
	},
});
