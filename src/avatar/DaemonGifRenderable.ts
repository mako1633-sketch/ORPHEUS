import {
	type CliRenderer,
	type FrameBufferOptions,
	FrameBufferRenderable,
	type OptimizedBuffer,
	RGBA,
	TextAttributes,
	type RenderContext,
} from "@opentui/core";
import { readFileSync } from "node:fs";
import { GifReader } from "omggif";

type CellFrame = {
	chars: Uint8Array;
	fg: Uint32Array;
	bg: Uint32Array;
	delayMs: number;
};

interface DaemonGifOptions extends FrameBufferOptions {
	src?: string;
	frameStride?: number;
}

const TRANSPARENT = 0;
const UPPER_BLOCK = 1;
const LOWER_BLOCK = 2;
const FULL_CELL = 3;
const MIN_FRAME_DELAY_MS = 33;
const DEFAULT_FRAME_STRIDE = 3;
const TRANSPARENT_ALPHA = RGBA.fromValues(0, 0, 0, 0);

function packColor(r: number, g: number, b: number, a: number): number {
	return ((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | (a & 255);
}

function unpackColor(color: number): RGBA {
	return RGBA.fromInts((color >>> 24) & 255, (color >>> 16) & 255, (color >>> 8) & 255, color & 255);
}

function isVisible(color: number): boolean {
	return (color & 255) > 20;
}

function samplePixel(
	pixels: Uint8Array,
	sourceWidth: number,
	sourceHeight: number,
	x: number,
	y: number,
	offsetX: number,
	offsetY: number,
	scale: number
): number {
	const sourceX = Math.floor((x - offsetX) / scale);
	const sourceY = Math.floor((y - offsetY) / scale);
	if (sourceX < 0 || sourceY < 0 || sourceX >= sourceWidth || sourceY >= sourceHeight) {
		return packColor(0, 0, 0, 0);
	}

	const index = (sourceY * sourceWidth + sourceX) * 4;
	return packColor(
		pixels[index] ?? 0,
		pixels[index + 1] ?? 0,
		pixels[index + 2] ?? 0,
		pixels[index + 3] ?? 0
	);
}

export class DaemonGifRenderable extends FrameBufferRenderable {
	private src = "";
	private frameStride: number;
	private frames: CellFrame[] = [];
	private loadError: Error | null = null;
	private loadedForSize: { width: number; height: number; src: string; stride: number } | null = null;
	private playbackStartedAt = performance.now();
	private totalDurationMs = 0;

	constructor(ctx: RenderContext, options: DaemonGifOptions) {
		super(ctx, {
			respectAlpha: true,
			...options,
		});
		this.src = options.src ?? "";
		this.frameStride = Math.max(1, Math.floor(options.frameStride ?? DEFAULT_FRAME_STRIDE));
	}

	set source(value: string) {
		if (value === this.src) return;
		this.src = value;
		this.loadedForSize = null;
		this.frames = [];
		this.requestRender();
	}

	set frameSampleStride(value: number) {
		const next = Math.max(1, Math.floor(value));
		if (next === this.frameStride) return;
		this.frameStride = next;
		this.loadedForSize = null;
		this.frames = [];
		this.requestRender();
	}

	private needsLoad(): boolean {
		const loaded = this.loadedForSize;
		return (
			!loaded ||
			loaded.width !== this.frameBuffer.width ||
			loaded.height !== this.frameBuffer.height ||
			loaded.src !== this.src ||
			loaded.stride !== this.frameStride
		);
	}

	private loadFramesForCurrentSize(): void {
		if (!this.src || !this.needsLoad()) return;

		this.frames = [];
		this.totalDurationMs = 0;
		this.loadError = null;

		try {
			const bytes = readFileSync(this.src);
			const reader = new GifReader(bytes);
			const rawPixels = new Uint8Array(reader.width * reader.height * 4);
			const cellWidth = Math.max(1, this.frameBuffer.width);
			const cellHeight = Math.max(1, this.frameBuffer.height);
			const targetPixelWidth = cellWidth;
			const targetPixelHeight = cellHeight * 2;
			const scale = Math.min(targetPixelWidth / reader.width, targetPixelHeight / reader.height);
			const scaledWidth = Math.max(1, Math.floor(reader.width * scale));
			const scaledHeight = Math.max(1, Math.floor(reader.height * scale));
			const offsetX = Math.floor((targetPixelWidth - scaledWidth) / 2);
			const offsetY = Math.floor((targetPixelHeight - scaledHeight) / 2);
			let accumulatedDelayMs = 0;

			for (let frameIndex = 0; frameIndex < reader.numFrames(); frameIndex++) {
				const info = reader.frameInfo(frameIndex);
				accumulatedDelayMs += Math.max(MIN_FRAME_DELAY_MS, (info.delay ?? 7) * 10);

				if (frameIndex % this.frameStride !== 0 && frameIndex !== reader.numFrames() - 1) {
					continue;
				}

				reader.decodeAndBlitFrameRGBA(frameIndex, rawPixels);
				this.frames.push(
					this.buildCellFrame(
						rawPixels,
						reader.width,
						reader.height,
						cellWidth,
						cellHeight,
						offsetX,
						offsetY,
						scale,
						accumulatedDelayMs
					)
				);
				this.totalDurationMs += accumulatedDelayMs;
				accumulatedDelayMs = 0;
			}

			this.loadedForSize = {
				width: this.frameBuffer.width,
				height: this.frameBuffer.height,
				src: this.src,
				stride: this.frameStride,
			};
			this.playbackStartedAt = performance.now();
		} catch (error) {
			this.loadError = error instanceof Error ? error : new Error(String(error));
		}
	}

	private buildCellFrame(
		pixels: Uint8Array,
		sourceWidth: number,
		sourceHeight: number,
		cellWidth: number,
		cellHeight: number,
		offsetX: number,
		offsetY: number,
		scale: number,
		delayMs: number
	): CellFrame {
		const cellCount = cellWidth * cellHeight;
		const chars = new Uint8Array(cellCount);
		const fg = new Uint32Array(cellCount);
		const bg = new Uint32Array(cellCount);

		for (let y = 0; y < cellHeight; y++) {
			for (let x = 0; x < cellWidth; x++) {
				const top = samplePixel(pixels, sourceWidth, sourceHeight, x, y * 2, offsetX, offsetY, scale);
				const bottom = samplePixel(pixels, sourceWidth, sourceHeight, x, y * 2 + 1, offsetX, offsetY, scale);
				const topVisible = isVisible(top);
				const bottomVisible = isVisible(bottom);
				const index = y * cellWidth + x;

				if (topVisible && bottomVisible) {
					chars[index] = FULL_CELL;
					fg[index] = top;
					bg[index] = bottom;
				} else if (topVisible) {
					chars[index] = UPPER_BLOCK;
					fg[index] = top;
				} else if (bottomVisible) {
					chars[index] = LOWER_BLOCK;
					fg[index] = bottom;
				} else {
					chars[index] = TRANSPARENT;
				}
			}
		}

		return { chars, fg, bg, delayMs };
	}

	private getCurrentFrame(): CellFrame | null {
		if (this.frames.length === 0 || this.totalDurationMs <= 0) return null;
		let elapsed = (performance.now() - this.playbackStartedAt) % this.totalDurationMs;
		for (const frame of this.frames) {
			if (elapsed <= frame.delayMs) return frame;
			elapsed -= frame.delayMs;
		}
		return this.frames[this.frames.length - 1] ?? null;
	}

	private drawFrame(frame: CellFrame): void {
		const fb = this.frameBuffer;
		fb.clear(TRANSPARENT_ALPHA);

		for (let y = 0; y < fb.height; y++) {
			for (let x = 0; x < fb.width; x++) {
				const index = y * fb.width + x;
				const charType = frame.chars[index] ?? TRANSPARENT;
				if (charType === TRANSPARENT) continue;

				const fg = unpackColor(frame.fg[index] ?? 0);
				const bgColor = charType === FULL_CELL ? unpackColor(frame.bg[index] ?? 0) : TRANSPARENT_ALPHA;
				const char = charType === LOWER_BLOCK ? "▄" : "▀";
				fb.setCellWithAlphaBlending(x, y, char, fg, bgColor);
			}
		}
	}

	protected override onResize(width: number, height: number): void {
		super.onResize(width, height);
		this.loadedForSize = null;
	}

	protected override renderSelf(buffer: OptimizedBuffer): void {
		if (!this.visible || this.isDestroyed) return;

		this.loadFramesForCurrentSize();

		if (this.loadError) {
			this.frameBuffer.clear(TRANSPARENT_ALPHA);
			this.frameBuffer.drawText(
				"ORPHEUS.GIF OFFLINE",
				1,
				Math.floor(this.frameBuffer.height / 2),
				RGBA.fromInts(255, 59, 48, 255),
				TRANSPARENT_ALPHA,
				TextAttributes.BOLD
			);
		} else {
			const frame = this.getCurrentFrame();
			if (frame) {
				this.drawFrame(frame);
			}
		}

		super.renderSelf(buffer);
		this._ctx.requestRender();
	}
}
