import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	buildUserContentParts,
	parseUserInputWithAttachments,
	readAttachment,
} from "../src/utils/file-attachment";

describe("file-attachment", () => {
	const tmpDir = join(process.cwd(), "__tests__", "__tmp__", "attachments-test");

	beforeAll(() => {
		mkdirSync(tmpDir, { recursive: true });
		writeFileSync(join(tmpDir, "hello.txt"), "Hello, world!");
		// A tiny valid PNG header (1x1 transparent pixel, base64)
		const tinyPngBase64 =
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhAATgW1ZHgAAAABJRU5ErkJggg==";
		writeFileSync(join(tmpDir, "pixel.png"), tinyPngBase64, "base64");
	});

	afterAll(() => {
		try {
			rmdirSync(tmpDir, { recursive: true });
		} catch {
			/* ignore */
		}
	});

	it("reads a text file and detects mime type", () => {
		const att = readAttachment(join(tmpDir, "hello.txt"));
		expect(att).not.toBeNull();
		if (att) {
			expect(att.name).toBe("hello.txt");
			expect(att.mimeType).toBe("text/plain");
			expect(att.isImage).toBe(false);
			expect(att.size).toBe(13);
			expect(typeof att.data).toBe("string");
		}
	});

	it("reads a png file and detects it as an image", () => {
		const att = readAttachment(join(tmpDir, "pixel.png"));
		expect(att).not.toBeNull();
		if (att) {
			expect(att.name).toBe("pixel.png");
			expect(att.mimeType).toBe("image/png");
			expect(att.isImage).toBe(true);
		}
	});

	it("returns null for a nonexistent file", () => {
		const att = readAttachment(join(tmpDir, "nonexistent.foo"));
		expect(att).toBeNull();
	});

	it("parses /attach command in input", () => {
		const result = parseUserInputWithAttachments(
			`/attach ${join(tmpDir, "hello.txt")} what do you think?`
		);
		expect(result.attachments.length).toBe(1);
		expect(result.attachments[0]?.name).toBe("hello.txt");
		expect(result.text).toBe("what do you think?");
		expect(result.hasExplicitText).toBe(true);
	});

	it("parses inline /attach tokens in input", () => {
		const result = parseUserInputWithAttachments(
			`Look at this /attach ${join(tmpDir, "pixel.png")} please`
		);
		expect(result.attachments.length).toBe(1);
		expect(result.attachments[0]?.isImage).toBe(true);
		expect(result.text).toBe("Look at this please");
	});

	it("builds content parts with images as AI SDK format", () => {
		const result = buildUserContentParts("look at this", [
			{
				name: "pixel.png",
				mimeType: "image/png",
				size: 100,
				isImage: true,
				data: "base64abc",
				path: "/tmp/pixel.png",
			},
		]);
		expect(Array.isArray(result)).toBe(true);
		if (Array.isArray(result)) {
			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({ type: "text", text: "look at this" });
			expect(result[1]).toMatchObject({
				type: "image",
				image: "base64abc",
				mediaType: "image/png",
			});
		}
	});

	it("builds content parts with non-images as file parts", () => {
		const result = buildUserContentParts("read this", [
			{
				name: "notes.txt",
				mimeType: "text/plain",
				size: 200,
				isImage: false,
				data: "base64xyz",
				path: "/tmp/notes.txt",
			},
		]);
		expect(Array.isArray(result)).toBe(true);
		if (Array.isArray(result)) {
			expect(result[1]).toMatchObject({
				type: "file",
				data: "base64xyz",
				filename: "notes.txt",
				mediaType: "text/plain",
			});
		}
	});

	it("returns plain string when no attachments", () => {
		const result = buildUserContentParts("hello world", []);
		expect(result).toBe("hello world");
	});
});
