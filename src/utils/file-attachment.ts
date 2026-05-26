/**
 * File attachment support for ORPHEUS terminal.
 *
 * When a user types `/attach <path>` (optionally followed by a text message),
 * this module reads the file, detects its MIME type, base64-encodes it,
 * and returns a structured attachment payload suitable for the AI SDK.
 *
 * Supported file types:
 *   Images: .png, .jpg, .jpeg, .gif, .webp, .bmp, .svg
 *   Documents: .pdf, .txt, .md, .csv, .json, .js, .ts, .tsx, .html, .css
 *   Archives: .zip (text extraction not supported — sent as raw file)
 */

import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { debug } from "./debug-logger";

/** Maximum file size we will read into memory (10 MB) */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Extensions we know how to map to MIME types */
const EXT_TO_MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
	".svg": "image/svg+xml",
	".pdf": "application/pdf",
	".txt": "text/plain",
	".md": "text/markdown",
	".csv": "text/csv",
	".json": "application/json",
	".js": "text/javascript",
	".ts": "text/typescript",
	".tsx": "text/typescript-jsx",
	".html": "text/html",
	".css": "text/css",
	".xml": "text/xml",
	".yaml": "text/yaml",
	".yml": "text/yaml",
	".zip": "application/zip",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function detectMimeType(filePath: string): string {
	const ext = extname(filePath).toLowerCase();
	return EXT_TO_MIME[ext] ?? "application/octet-stream";
}

function isImageMimeType(mimeType: string): boolean {
	return mimeType.startsWith("image/");
}

/** File attachment result from reading a local file */
export interface FileAttachment {
	/** Absolute path on disk */
	path: string;
	/** Detected MIME type */
	mimeType: string;
	/** Base64-encoded content */
	data: string;
	/** Human-friendly label for UI */
	name: string;
	/** Rough size in bytes */
	size: number;
	/** Whether this is an image that can be rendered inline */
	isImage: boolean;
}

export interface ParsedUserInput {
	/** The text the user wants to send (may be empty) */
	text: string;
	/** Any file attachments parsed from `/attach <path>` */
	attachments: FileAttachment[];
	/** Whether the raw input was ONLY attachments with no text */
	hasExplicitText: boolean;
}

/** Attempt to read and encode a single file as a base64 attachment. Returns null on failure. */
export function readAttachment(filePath: string): FileAttachment | null {
	try {
		const absolutePath = resolve(filePath);
		const buffer = readFileSync(absolutePath);

		if (buffer.length > MAX_FILE_SIZE) {
			debug.warn("file-attachment", {
				path: absolutePath,
				reason: "File exceeds 10 MB limit",
				size: buffer.length,
			});
			return null;
		}

		const mimeType = detectMimeType(absolutePath);
		const data = buffer.toString("base64");

		return {
			path: absolutePath,
			mimeType,
			data,
			name: absolutePath.split("/").pop() ?? absolutePath,
			size: buffer.length,
			isImage: isImageMimeType(mimeType),
		};
	} catch (err) {
		debug.error("file-attachment", {
			path: filePath,
			reason: err instanceof Error ? err.message : String(err),
		});
		return null;
	}
}

const ATTACH_REGEX = /^\/attach\s+(\S+)(?:\s+(.*))?$/;
const ATTACH_INLINE_REGEX = /\/attach\s+(\S+)/g;

/**
 * Parse user input text for `/attach <path>` commands.
 *
 * Supports two styles:
 *   1. `/attach /path/to/file.png` (entire line is the command)
 *   2. Inline anywhere in the message: `Look at this /attach /tmp/screenshot.png please`
 *
 * Returns the cleaned text with `/attach` tokens removed and the list of
 * successfully read attachments. Failed attachments are silently dropped
 * with a debug log.
 */
export function parseUserInputWithAttachments(rawInput: string): ParsedUserInput {
	const attachments: FileAttachment[] = [];
	let text = rawInput;
	let hasExplicitText = rawInput.trim().length > 0;

	// Check if the entire input is a single /attach command
	const singleMatch = rawInput.trim().match(ATTACH_REGEX);
	if (singleMatch && !rawInput.includes("\n")) {
		const filePath = singleMatch[1];
		if (filePath) {
			const remainingText = singleMatch[2] ?? "";
			const attachment = readAttachment(filePath);
			if (attachment) {
				attachments.push(attachment);
			}
			return {
				text: remainingText.trim(),
				attachments,
				hasExplicitText: remainingText.trim().length > 0,
			};
		}
	}

	// Inline /attach tokens anywhere in the message
	text = rawInput.replace(ATTACH_INLINE_REGEX, (_match, capture: string | undefined) => {
		if (!capture) return "";
		const attachment = readAttachment(capture);
		if (attachment) {
			attachments.push(attachment);
		}
		return "";
	});

	// Clean up extra whitespace left by removals
	text = text.replace(/\s{2,}/g, " ").trim();

	return { text, attachments, hasExplicitText };
}

/** Convert a FileAttachment into an AI SDK content part */
export function attachmentToContentPart(
	attachment: FileAttachment
):
	| { type: "image"; image: string; mediaType?: string }
	| { type: "file"; data: string; filename?: string; mediaType: string } {
	if (attachment.isImage) {
		return { type: "image", image: attachment.data, mediaType: attachment.mimeType };
	}
	return {
		type: "file",
		data: attachment.data,
		filename: attachment.name,
		mediaType: attachment.mimeType,
	};
}

/** Build user message content array with text + attachments */
export function buildUserContentParts(
	text: string,
	attachments: FileAttachment[]
):
	| string
	| Array<
			| { type: "text"; text: string }
			| { type: "image"; image: string; mediaType?: string }
			| { type: "file"; data: string; filename?: string; mediaType: string }
	  > {
	if (attachments.length === 0) {
		return text;
	}

	const parts: Array<
		| { type: "text"; text: string }
		| { type: "image"; image: string; mediaType?: string }
		| { type: "file"; data: string; filename?: string; mediaType: string }
	> = [];

	if (text.trim()) {
		parts.push({ type: "text", text });
	}

	for (const attachment of attachments) {
		parts.push(attachmentToContentPart(attachment));
	}

	return parts;
}
