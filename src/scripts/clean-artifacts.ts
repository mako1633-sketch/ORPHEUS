import { existsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dir, "..", "..");
const removableDirs = ["dist", "out", "coverage", "tmp", ".cache", ".npm-cache", ".npm-cache-qr"];
const removableFileExtensions = new Set([".tgz", ".lcov", ".tsbuildinfo", ".log"]);
const removableReportPattern = /^report\.\d+\.\d+\.\d+\.\d+\.json$/;

function insideProject(target: string): boolean {
	const relative = path.relative(projectRoot, target);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function removePath(target: string): Promise<void> {
	const resolved = path.resolve(target);
	if (!insideProject(resolved)) {
		throw new Error(`Refusing to remove path outside project root: ${resolved}`);
	}
	if (!existsSync(resolved)) return;
	try {
		await rm(resolved, { recursive: true, force: true });
		console.log(`removed ${path.relative(projectRoot, resolved)}`);
	} catch (error) {
		const entry = await stat(resolved).catch(() => null);
		if (!entry?.isDirectory()) {
			console.warn(`skipped locked artifact ${path.relative(projectRoot, resolved)}`);
			return;
		}
		const children = await readdir(resolved);
		for (const child of children) {
			await removePath(path.join(resolved, child));
		}
		console.log(`cleared ${path.relative(projectRoot, resolved)}`);
	}
}

async function cleanRootFiles(): Promise<void> {
	const entries = await readdir(projectRoot, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const shouldRemove =
			removableFileExtensions.has(path.extname(entry.name)) || removableReportPattern.test(entry.name);
		if (shouldRemove) {
			await removePath(path.join(projectRoot, entry.name));
		}
	}
}

for (const dir of removableDirs) {
	await removePath(path.join(projectRoot, dir));
}
await cleanRootFiles();
