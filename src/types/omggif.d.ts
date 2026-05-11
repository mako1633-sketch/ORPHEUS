declare module "omggif" {
	export interface GifFrameInfo {
		x: number;
		y: number;
		width: number;
		height: number;
		delay?: number;
		disposal?: number;
		transparent_index?: number | null;
	}

	export class GifReader {
		width: number;
		height: number;
		constructor(buffer: Uint8Array | Buffer);
		numFrames(): number;
		frameInfo(frameIndex: number): GifFrameInfo;
		decodeAndBlitFrameRGBA(frameIndex: number, pixels: Uint8Array): void;
	}
}
