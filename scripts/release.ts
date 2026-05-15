#!/usr/bin/env bun
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const mode = process.argv[2] ?? "";
const validModes = new Set(["patch", "minor", "major", "notes"]);

function usage(): never {
	console.error("Usage: bun run scripts/release.ts <patch|minor|major|notes>");
	process.exit(1);
}

function run(command: string, args: string[], options: { stdio?: "inherit" | "pipe" } = {}): string {
	const stdio = options.stdio ?? "pipe";
	return execFileSync(command, args, {
		encoding: "utf8",
		stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
	});
}

function latestTag(ref = "HEAD"): string {
	try {
		return run("git", ["describe", "--tags", "--abbrev=0", ref]).trim();
	} catch {
		return "";
	}
}

function releaseNotesFor(tag: string): string {
	const previousTag = latestTag(`${tag}^`);
	const range = previousTag ? `${previousTag}..${tag}` : tag;
	try {
		return run("git", ["log", "--pretty=format:- %s (%h)", range]).trim();
	} catch {
		return "";
	}
}

if (!validModes.has(mode)) usage();

if (mode === "notes") {
	const currentTag = latestTag();
	if (!currentTag) {
		console.error("No tags found.");
		process.exit(1);
	}
	console.log(releaseNotesFor(currentTag));
	process.exit(0);
}

run("npm", ["version", mode], { stdio: "inherit" });
run("git", ["push"], { stdio: "inherit" });
run("git", ["push", "--tags"], { stdio: "inherit" });

const version = run("node", ["-p", "require('./package.json').version"]).trim();
const newTag = `v${version}`;
const notes = `## Changes\n${releaseNotesFor(newTag)}\n`;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "orpheus-release-"));
const notesFile = path.join(tempDir, "notes.md");

try {
	await writeFile(notesFile, notes, "utf8");
	run("gh", ["release", "create", newTag, "--notes-file", notesFile], { stdio: "inherit" });
} finally {
	await rm(tempDir, { recursive: true, force: true });
}

run("npm", ["publish"], { stdio: "inherit" });
