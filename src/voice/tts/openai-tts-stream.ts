/**
 * OpenAI TTS client using the streaming API.
 * Generates speech audio and emits PCM chunks as they arrive for real-time playback.
 */

import { EventEmitter } from "node:events";
import OpenAI from "openai";
import type { SpeechCreateParams } from "openai/resources/audio/speech";

export interface OpenAITTSOptions {
	/** OpenAI API key (defaults to OPENAI_API_KEY env var) */
	apiKey?: string;
	/** OpenAI speech model (default: gpt-realtime-2) */
	model?: string;
	/** Voice name (default: ballad) */
	voice?: string | { id: string };
	/** Output format (default: pcm) */
	outputFormat?: SpeechCreateParams["response_format"];
	/** Speech speed multiplier (0.25 to 4.0) */
	speed?: SpeechCreateParams["speed"];
	/** Optional style instructions (works with gpt-4o-mini-tts, not tts-1/tts-1-hd) */
	instructions?: SpeechCreateParams["instructions"];
}

export interface OpenAITTSStreamEvents {
	audio: (chunk: Buffer) => void;
	done: () => void;
	error: (error: Error) => void;
}

export const OPENAI_REALTIME_SPEECH_MODEL = "gpt-realtime-2";
export const OPENAI_REALTIME_SPEECH_VOICE = "ballad";
const DEFAULT_MODEL = OPENAI_REALTIME_SPEECH_MODEL;
const DEFAULT_VOICE = OPENAI_REALTIME_SPEECH_VOICE;
const DEFAULT_FORMAT: SpeechCreateParams["response_format"] = "pcm";
const DEFAULT_SPEED = 1.1;
const REALTIME_URL = "wss://api.openai.com/v1/realtime";
const REALTIME_SPEECH_INSTRUCTIONS =
	"Speak the supplied text aloud exactly as written. Do not add greetings, commentary, markdown, or extra words.";

interface SpeechAudioDeltaEvent {
	type: "speech.audio.delta";
	audio: string;
}

interface SpeechAudioDoneEvent {
	type: "speech.audio.done";
	usage?: {
		input_tokens: number;
		output_tokens: number;
		total_tokens: number;
	};
}

type SpeechStreamEvent = SpeechAudioDeltaEvent | SpeechAudioDoneEvent;

interface RealtimeAudioDeltaEvent {
	type: "response.output_audio.delta";
	delta: string;
}

interface RealtimeAudioDoneEvent {
	type: "response.output_audio.done";
}

interface RealtimeResponseDoneEvent {
	type: "response.done";
	response?: {
		status?: string;
		status_details?: {
			error?: {
				message?: string;
			};
			reason?: string;
		};
	};
}

interface RealtimeErrorEvent {
	type: "error";
	error?: {
		message?: string;
	};
}

type RealtimeStreamEvent =
	| RealtimeAudioDeltaEvent
	| RealtimeAudioDoneEvent
	| RealtimeResponseDoneEvent
	| RealtimeErrorEvent;

/**
 * OpenAI TTS client using the streaming API.
 * Emits 'audio' events with Buffer chunks as they arrive, then 'done' when complete.
 */
export class OpenAITTSStream extends EventEmitter {
	private client: OpenAI;
	private apiKey?: string;
	private model: string;
	private voice: string | { id: string };
	private outputFormat: SpeechCreateParams["response_format"];
	private speed: SpeechCreateParams["speed"];
	private instructions: SpeechCreateParams["instructions"];
	private _isSpeaking = false;
	private _aborted = false;
	private abortController: AbortController | null = null;
	private realtimeSocket: WebSocket | null = null;

	constructor(options: OpenAITTSOptions = {}) {
		super();

		this.apiKey = options.apiKey;
		this.client = new OpenAI({
			apiKey: options.apiKey,
		});
		this.model = options.model ?? DEFAULT_MODEL;
		this.voice = options.voice ?? DEFAULT_VOICE;
		this.outputFormat = options.outputFormat ?? DEFAULT_FORMAT;
		this.speed = options.speed ?? DEFAULT_SPEED;
		this.instructions = options.instructions;
	}

	get isSpeaking(): boolean {
		return this._isSpeaking;
	}

	async speak(text: string): Promise<void> {
		if (!text.trim()) {
			this.emit("done");
			return;
		}

		this.stop();
		this._aborted = false;
		this._isSpeaking = true;
		this.abortController = new AbortController();

		try {
			const modelStr = String(this.model);
			if (modelStr.startsWith("gpt-realtime")) {
				await this.speakWithRealtime(text);
				return;
			}

			const supportsSSE = !modelStr.startsWith("tts-1");

			const params: SpeechCreateParams = {
				model: this.model as SpeechCreateParams["model"],
				input: text,
				voice: this.voice as SpeechCreateParams["voice"],
				response_format: this.outputFormat,
				speed: this.speed,
			};

			if (supportsSSE) {
				params.stream_format = "sse";
				if (this.instructions) {
					params.instructions = this.instructions;
				}
			}

			const response = await this.client.audio.speech.create(params, {
				signal: this.abortController.signal,
			});

			const body = response.body;
			if (!body) {
				throw new Error("No response body from OpenAI TTS API");
			}

			if (supportsSSE) {
				await this.processSSEStream(body);
			} else {
				await this.processRawAudioStream(body);
			}

			this._isSpeaking = false;
			if (!this._aborted) {
				this.emit("done");
			}
		} catch (error) {
			this._isSpeaking = false;
			if (!this._aborted) {
				const err = error instanceof Error ? error : new Error(String(error));
				this.emit("error", err);
			}
		} finally {
			this.abortController = null;
		}
	}

	private async speakWithRealtime(text: string): Promise<void> {
		if (this.outputFormat !== "pcm") {
			throw new Error("Realtime TTS playback only supports pcm output.");
		}

		const apiKey = this.apiKey ?? process.env.OPENAI_API_KEY;
		if (!apiKey) {
			throw new Error("OPENAI_API_KEY is required for OpenAI Realtime speech.");
		}

		const url = `${REALTIME_URL}?model=${encodeURIComponent(this.model)}`;
		const ws = new WebSocket(url, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
		});
		this.realtimeSocket = ws;

		try {
			await new Promise<void>((resolve, reject) => {
				let settled = false;
				const fail = (error: Error) => {
					if (settled) return;
					settled = true;
					reject(error);
				};
				const succeed = () => {
					if (settled) return;
					settled = true;
					resolve();
				};

				ws.addEventListener("open", () => {
					if (this._aborted) {
						succeed();
						return;
					}

					ws.send(
						JSON.stringify({
							type: "session.update",
							session: {
								type: "realtime",
								model: this.model,
								output_modalities: ["audio"],
								instructions: this.instructions ?? REALTIME_SPEECH_INSTRUCTIONS,
								audio: {
									output: {
										format: {
											type: "audio/pcm",
											rate: 24000,
										},
										speed: this.getRealtimeSpeed(),
										voice: this.voice,
									},
								},
							},
						})
					);

					ws.send(
						JSON.stringify({
							type: "response.create",
							response: {
								conversation: "none",
								output_modalities: ["audio"],
								instructions: this.instructions ?? REALTIME_SPEECH_INSTRUCTIONS,
								audio: {
									output: {
										format: {
											type: "audio/pcm",
											rate: 24000,
										},
										voice: this.voice,
									},
								},
								input: [
									{
										type: "message",
										role: "user",
										content: [
											{
												type: "input_text",
												text,
											},
										],
									},
								],
							},
						})
					);
				});

				ws.addEventListener("message", (event) => {
					if (this._aborted) return;

					try {
						const realtimeEvent = JSON.parse(
							this.websocketDataToString(event.data)
						) as RealtimeStreamEvent;

						if (realtimeEvent.type === "response.output_audio.delta") {
							this.emit("audio", Buffer.from(realtimeEvent.delta, "base64"));
							return;
						}

						if (realtimeEvent.type === "response.done") {
							const status = realtimeEvent.response?.status;
							if (status && status !== "completed") {
								const message =
									realtimeEvent.response?.status_details?.error?.message ??
									realtimeEvent.response?.status_details?.reason ??
									`Realtime response ended with status: ${status}`;
								fail(new Error(message));
								return;
							}

							succeed();
							return;
						}

						if (realtimeEvent.type === "error") {
							fail(new Error(realtimeEvent.error?.message ?? "OpenAI Realtime speech failed."));
						}
					} catch (error) {
						fail(error instanceof Error ? error : new Error(String(error)));
					}
				});

				ws.addEventListener("error", () => {
					fail(new Error("OpenAI Realtime WebSocket error."));
				});

				ws.addEventListener("close", () => {
					if (!settled && !this._aborted) {
						fail(new Error("OpenAI Realtime WebSocket closed before speech completed."));
					}
				});

				this.abortController?.signal.addEventListener(
					"abort",
					() => {
						succeed();
					},
					{ once: true }
				);
			});
		} finally {
			this.closeRealtimeSocket();
		}

		this._isSpeaking = false;
		if (!this._aborted) {
			this.emit("done");
		}
	}

	private getRealtimeSpeed(): number {
		const speed = Number(this.speed ?? DEFAULT_SPEED);
		if (!Number.isFinite(speed)) return DEFAULT_SPEED;
		return Math.min(1.5, Math.max(0.25, speed));
	}

	private websocketDataToString(data: unknown): string {
		if (typeof data === "string") return data;
		if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
		if (ArrayBuffer.isView(data))
			return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
		return String(data);
	}

	private async processSSEStream(body: ReadableStream<Uint8Array>): Promise<void> {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				if (this._aborted) break;

				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (this._aborted) break;

					const trimmed = line.trim();
					if (!trimmed || trimmed.startsWith(":")) continue;

					if (trimmed.startsWith("data: ")) {
						const data = trimmed.slice(6);
						if (data === "[DONE]") continue;

						try {
							const event = JSON.parse(data) as SpeechStreamEvent;

							if (event.type === "speech.audio.delta") {
								const audioBuffer = Buffer.from(event.audio, "base64");
								this.emit("audio", audioBuffer);
							}
						} catch {}
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	private async processRawAudioStream(body: ReadableStream<Uint8Array>): Promise<void> {
		const reader = body.getReader();

		try {
			while (true) {
				if (this._aborted) break;

				const { done, value } = await reader.read();
				if (done) break;

				this.emit("audio", Buffer.from(value));
			}
		} finally {
			reader.releaseLock();
		}
	}

	stop(): void {
		this._aborted = true;
		this.closeRealtimeSocket();

		if (this.abortController) {
			try {
				this.abortController.abort();
			} catch {}
			this.abortController = null;
		}

		this._isSpeaking = false;
	}

	private closeRealtimeSocket(): void {
		if (!this.realtimeSocket) return;

		try {
			this.realtimeSocket.close();
		} catch {}
		this.realtimeSocket = null;
	}

	destroy(): void {
		this.stop();
		this.removeAllListeners();
	}
}
