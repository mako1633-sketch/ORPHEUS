#!/usr/bin/env bun
import os from "node:os";
import path from "node:path";
import { indexDirectory } from "../src/ai/knowledge-base";

async function main(): Promise<void> {
	const root = process.argv[2] || path.join(os.homedir(), "Documents", "Orpheus");
	console.log(`Indexing ${root}...`);
	const { indexed, errors } = await indexDirectory(root);
	console.log(`Done. ${indexed} files indexed, ${errors} errors.`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
