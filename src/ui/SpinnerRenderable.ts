import { type RenderContext, TextRenderable, type TextOptions } from "@opentui/core";
import spinners from "cli-spinners";

type SpinnerDefinition = {
	interval: number;
	frames: string[];
};

export interface SpinnerOptions extends TextOptions {
	name?: keyof typeof spinners | string;
	frames?: string[];
	interval?: number;
	autoplay?: boolean;
	color?: TextOptions["fg"];
	backgroundColor?: TextOptions["bg"];
}

const FALLBACK_SPINNER: SpinnerDefinition = {
	interval: 80,
	frames: ["-", "\\", "|", "/"],
};

function resolveSpinner(name: string | undefined, frames: string[] | undefined): SpinnerDefinition {
	if (frames && frames.length > 0) {
		return {
			interval: FALLBACK_SPINNER.interval,
			frames,
		};
	}

	const spinner = name
		? (spinners as Record<string, SpinnerDefinition | undefined>)[name]
		: undefined;
	return (
		spinner ??
		((spinners as Record<string, SpinnerDefinition | undefined>).dots || FALLBACK_SPINNER)
	);
}

export class SpinnerRenderable extends TextRenderable {
	private spinnerName: string | undefined;
	private spinnerFrames: string[] | undefined;
	private spinnerInterval: number;
	private frameIndex = 0;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(ctx: RenderContext, options: SpinnerOptions = {}) {
		const definition = resolveSpinner(options.name, options.frames);
		const interval = Math.max(16, Math.floor(options.interval ?? definition.interval));
		super(ctx, {
			...options,
			fg: options.color ?? options.fg,
			bg: options.backgroundColor ?? options.bg,
			content: definition.frames[0] ?? "",
			width: options.width ?? "auto",
			height: options.height ?? 1,
			selectable: options.selectable ?? false,
		});

		this.spinnerName = options.name;
		this.spinnerFrames = options.frames;
		this.spinnerInterval = interval;

		if (options.autoplay !== false) {
			this.start();
		}
	}

	set name(value: string | undefined) {
		this.spinnerName = value;
		this.frameIndex = 0;
		this.updateFrame();
	}

	set frames(value: string[] | undefined) {
		this.spinnerFrames = value;
		this.frameIndex = 0;
		this.updateFrame();
	}

	set interval(value: number | undefined) {
		const next = Math.max(16, Math.floor(value ?? FALLBACK_SPINNER.interval));
		if (next === this.spinnerInterval) return;
		this.spinnerInterval = next;
		if (this.timer) {
			this.stop();
			this.start();
		}
	}

	set color(value: TextOptions["fg"]) {
		this.fg = value;
	}

	set backgroundColor(value: TextOptions["bg"]) {
		this.bg = value;
	}

	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => this.tick(), this.spinnerInterval);
	}

	stop(): void {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = null;
	}

	override destroy(): void {
		this.stop();
		super.destroy();
	}

	private tick(): void {
		this.frameIndex++;
		this.updateFrame();
	}

	private updateFrame(): void {
		const definition = resolveSpinner(this.spinnerName, this.spinnerFrames);
		const frame = definition.frames[this.frameIndex % definition.frames.length] ?? "";
		this.content = frame;
		this.requestRender();
	}
}
