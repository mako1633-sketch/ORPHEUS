/**
 * AI Red Team Multimodal Execution Harness
 *
 * Adapters for image, voice, and document probes.
 * Converts media inputs into model-compatible prompts,
 * enabling red-team testing across modalities.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname } from "node:path";

export type Modality = "text" | "image" | "voice" | "document";

export interface MultimodalInput {
	modality: Modality;
	/** Text prompt or instruction */
	prompt: string;
	/** File path to media (image, audio, document) */
	mediaPath?: string;
	/** Base64-encoded media data (alternative to file path) */
	mediaBase64?: string;
	/** MIME type hint, e.g. image/png, audio/mp3, application/pdf */
	mimeType?: string;
}

export interface PreparedPrompt {
	modality: Modality;
	/** Final text payload sent to the model */
	text: string;
	/** For vision models: base64 image data URI */
	imageDataUri?: string;
	/** For voice models: extracted transcript or raw audio info */
	voiceInfo?: {
		transcript?: string;
		durationMs?: number;
		format?: string;
	};
	/** For document models: extracted text content */
	documentText?: string;
	/** Metadata about preparation */
	preparationMeta: {
		method: string;
		warnings: string[];
		originalSizeBytes?: number;
	};
}

export interface ModalityAdapter {
	modality: Modality;
	/**
	 * Prepare a media input into a model-ready format.
	 * May perform local file reads, base64 encoding, or placeholder generation.
	 */
	prepare(input: MultimodalInput): Promise<PreparedPrompt>;
	/**
	 * Return true if this adapter can handle the given input.
	 */
	supports(input: MultimodalInput): boolean;
}

// ── Utilities ───────────────────────────────────────────────────────────

async function readFileAsBase64(
	path: string
): Promise<{ base64: string; mimeType: string; size: number }> {
	if (!existsSync(path)) throw new Error(`File not found: ${path}`);
	const buffer = await readFile(path);
	const ext = extname(path).toLowerCase();
	let mimeType = "application/octet-stream";
	if (ext === ".png") mimeType = "image/png";
	else if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
	else if (ext === ".gif") mimeType = "image/gif";
	else if (ext === ".webp") mimeType = "image/webp";
	else if (ext === ".mp3") mimeType = "audio/mpeg";
	else if (ext === ".wav") mimeType = "audio/wav";
	else if (ext === ".m4a") mimeType = "audio/mp4";
	else if (ext === ".ogg") mimeType = "audio/ogg";
	else if (ext === ".pdf") mimeType = "application/pdf";
	else if (ext === ".txt") mimeType = "text/plain";
	else if (ext === ".md") mimeType = "text/markdown";
	return { base64: buffer.toString("base64"), mimeType, size: buffer.length };
}

function buildImageDataUri(base64: string, mimeType: string): string {
	return `data:${mimeType};base64,${base64}`;
}

function truncate(str: string, max: number): string {
	return str.length > max ? str.slice(0, max) + "…" : str;
}

// ── Image Adapter ─────────────────────────────────────────────────────

export class ImageAdapter implements ModalityAdapter {
	modality = "image" as const;

	supports(input: MultimodalInput): boolean {
		return (
			input.modality === "image" &&
			(input.mediaPath !== undefined || input.mediaBase64 !== undefined)
		);
	}

	async prepare(input: MultimodalInput): Promise<PreparedPrompt> {
		const warnings: string[] = [];
		let dataUri: string | undefined;
		let originalSizeBytes: number | undefined;

		if (input.mediaPath) {
			try {
				const { base64, mimeType, size } = await readFileAsBase64(input.mediaPath);
				dataUri = buildImageDataUri(base64, mimeType);
				originalSizeBytes = size;
				if (size > 20 * 1024 * 1024) {
					warnings.push(
						`Large image (${(size / 1024 / 1024).toFixed(1)}MB); some APIs reject >20MB`
					);
				}
			} catch (e) {
				warnings.push(`Failed to read image file: ${e instanceof Error ? e.message : String(e)}`);
			}
		} else if (input.mediaBase64 && input.mimeType) {
			dataUri = buildImageDataUri(input.mediaBase64, input.mimeType);
		}

		if (!dataUri) {
			warnings.push("No image data available; sending text-only prompt");
		}

		return {
			modality: "image",
			text: input.prompt,
			imageDataUri: dataUri,
			preparationMeta: {
				method: "base64-data-uri",
				warnings,
				originalSizeBytes,
			},
		};
	}
}

// ── Voice Adapter ─────────────────────────────────────────────────────

export class VoiceAdapter implements ModalityAdapter {
	modality = "voice" as const;

	supports(input: MultimodalInput): boolean {
		return (
			input.modality === "voice" &&
			(input.mediaPath !== undefined || input.mediaBase64 !== undefined)
		);
	}

	async prepare(input: MultimodalInput): Promise<PreparedPrompt> {
		const warnings: string[] = [];
		let format = "unknown";
		let originalSizeBytes: number | undefined;

		if (input.mediaPath) {
			format = extname(input.mediaPath).toLowerCase().replace(".", "");
			try {
				const stats = await readFile(input.mediaPath);
				originalSizeBytes = stats.length;
				if (stats.length > 25 * 1024 * 1024) {
					warnings.push(
						`Large audio file (${(stats.length / 1024 / 1024).toFixed(1)}MB); some APIs reject >25MB`
					);
				}
			} catch {
				// size unknown, continue
			}
		}

		// Note: actual transcription requires an external API (OpenAI Whisper, etc.)
		// This harness prepares the prompt and marks transcription as a downstream step.
		const transcriptHint = input.mediaPath
			? `[Voice input from file: ${basename(input.mediaPath)}]`
			: "[Voice input provided]";

		return {
			modality: "voice",
			text: `${input.prompt}\n\n${transcriptHint}`,
			voiceInfo: {
				transcript: undefined, // populated by transcription service
				format,
			},
			preparationMeta: {
				method: "voice-passthrough-with-transcription-placeholder",
				warnings: [
					...warnings,
					"Voice transcription not performed locally. Route through a speech-to-text API before scoring.",
				],
				originalSizeBytes,
			},
		};
	}
}

// ── Document Adapter ────────────────────────────────────────────────────

export class DocumentAdapter implements ModalityAdapter {
	modality = "document" as const;

	supports(input: MultimodalInput): boolean {
		return (
			input.modality === "document" &&
			(input.mediaPath !== undefined || input.mediaBase64 !== undefined)
		);
	}

	async prepare(input: MultimodalInput): Promise<PreparedPrompt> {
		const warnings: string[] = [];
		let text = "";
		let originalSizeBytes: number | undefined;

		if (input.mediaPath) {
			const ext = extname(input.mediaPath).toLowerCase();
			try {
				const buffer = await readFile(input.mediaPath);
				originalSizeBytes = buffer.length;

				if (ext === ".txt" || ext === ".md" || ext === ".csv" || ext === ".json") {
					text = buffer.toString("utf-8");
				} else if (ext === ".pdf") {
					// PDF text extraction requires an external library; placeholder here.
					warnings.push(
						"PDF text extraction not implemented locally. Use an external parser (e.g. pdf-parse) and pass extracted text."
					);
					text = `[PDF document: ${basename(input.mediaPath)} — text extraction required]`;
				} else {
					warnings.push(
						`Unsupported document format "${ext}". Supported: .txt, .md, .csv, .json, .pdf`
					);
					text = `[Document: ${basename(input.mediaPath)} — unsupported format]`;
				}
			} catch (e) {
				warnings.push(`Failed to read document: ${e instanceof Error ? e.message : String(e)}`);
			}
		} else if (input.mediaBase64) {
			warnings.push(
				"Base64 document without path; decoding not implemented. Pass a file path instead."
			);
		}

		const truncatedText = truncate(text, 150_000); // cap extracted text length
		if (text.length > 150_000) {
			warnings.push(`Document text truncated from ${text.length} to 150k chars`);
		}

		return {
			modality: "document",
			text: `${input.prompt}\n\n--- Document Content ---\n${truncatedText}\n--- End Document ---`,
			documentText: truncatedText,
			preparationMeta: {
				method:
					extname(input.mediaPath ?? "").toLowerCase() === ".pdf"
						? "pdf-placeholder"
						: "text-extraction",
				warnings,
				originalSizeBytes,
			},
		};
	}
}

// ── Text Fallback Adapter ───────────────────────────────────────────────

export class TextAdapter implements ModalityAdapter {
	modality = "text" as const;

	supports(): boolean {
		return true; // fallback
	}

	async prepare(input: MultimodalInput): Promise<PreparedPrompt> {
		return {
			modality: "text",
			text: input.prompt,
			preparationMeta: {
				method: "pass-through",
				warnings: [],
			},
		};
	}
}

// ── Harness ─────────────────────────────────────────────────────────────

const DEFAULT_ADAPTERS: ModalityAdapter[] = [
	new ImageAdapter(),
	new VoiceAdapter(),
	new DocumentAdapter(),
	new TextAdapter(),
];

export class MultimodalHarness {
	private adapters: ModalityAdapter[];

	constructor(adapters?: ModalityAdapter[]) {
		this.adapters = adapters ?? [...DEFAULT_ADAPTERS];
	}

	/**
	 * Register an additional adapter (prepended, so it wins over defaults).
	 */
	register(adapter: ModalityAdapter): void {
		this.adapters.unshift(adapter);
	}

	/**
	 * Prepare a multimodal input into a model-compatible prompt.
	 */
	async prepare(input: MultimodalInput): Promise<PreparedPrompt> {
		for (const adapter of this.adapters) {
			if (adapter.supports(input)) {
				return adapter.prepare(input);
			}
		}
		// Should never reach here because TextAdapter is universal fallback
		throw new Error(`No adapter found for modality "${input.modality}"`);
	}

	/**
	 * Convenience: prepare and send via a text-based sendPrompt function.
	 * For true multimodal APIs (e.g. GPT-4o vision), the caller should use
	 * the prepared imageDataUri / documentText fields directly.
	 */
	async send(
		input: MultimodalInput,
		sendTextPrompt: (prompt: string) => Promise<string>
	): Promise<{ prepared: PreparedPrompt; output: string }> {
		const prepared = await this.prepare(input);
		const output = await sendTextPrompt(prepared.text);
		return { prepared, output };
	}
}

/**
 * Factory function: create a harness with default adapters.
 */
export function createMultimodalHarness(adapters?: ModalityAdapter[]): MultimodalHarness {
	return new MultimodalHarness(adapters);
}
