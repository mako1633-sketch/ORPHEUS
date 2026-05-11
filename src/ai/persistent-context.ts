import { promises as fs } from "node:fs";
import path from "node:path";
import { getAppConfigDir } from "../utils/preferences";

const PERSISTENT_CONTEXT_FILE = "persistent-context.md";
const MAX_CONTEXT_CHARS = 12_000;

export function getPersistentContextPath(): string {
	return path.join(getAppConfigDir(), PERSISTENT_CONTEXT_FILE);
}

export async function loadPersistentContext(): Promise<string> {
	try {
		const context = await fs.readFile(getPersistentContextPath(), "utf8");
		return context.trim();
	} catch {
		return "";
	}
}

export async function savePersistentContext(content: string): Promise<{
	path: string;
	bytesWritten: number;
	truncated: boolean;
}> {
	const contextPath = getPersistentContextPath();
	const dir = path.dirname(contextPath);
	await fs.mkdir(dir, { recursive: true });

	const normalized = content.trim();
	const truncated = normalized.length > MAX_CONTEXT_CHARS;
	const finalContent = truncated ? normalized.slice(-MAX_CONTEXT_CHARS).trim() : normalized;
	const payload = finalContent ? `${finalContent}\n` : "";

	await fs.writeFile(contextPath, payload, "utf8");
	return {
		path: contextPath,
		bytesWritten: Buffer.byteLength(payload, "utf8"),
		truncated,
	};
}

export async function appendPersistentContext(content: string): Promise<{
	path: string;
	bytesWritten: number;
	truncated: boolean;
}> {
	const existing = await loadPersistentContext();
	const timestamp = new Date().toISOString();
	const entry = `- ${timestamp}: ${content.trim()}`;
	const next = existing ? `${existing}\n${entry}` : `# ORPHEUS Persistent Context\n\n${entry}`;
	return savePersistentContext(next);
}

export function formatPersistentContextForPrompt(context: string): string {
	const trimmed = context.trim();
	if (!trimmed) return "";

	return `<persistent-context>
The following local context persists across ORPHEUS sessions. Use it when relevant:

${trimmed}
</persistent-context>`;
}
