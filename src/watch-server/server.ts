/**
 * ORPHEUS Watch Server — local HTTP/WebSocket gateway for the Apple Watch companion.
 *
 * Architecture: watchOS app ↔ iOS companion ↔ this server (on Mac)
 * The watch sends commands; the server streams back status and responses.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { daemonEvents } from "../state/daemon-events";
import { getDaemonManager } from "../state/daemon-state";
import { DaemonState as DaemonStateEnum } from "../types";
import { debug } from "../utils/debug-logger";
import type {
	WatchCommand,
	WatchErrorResponse,
	WatchHistoryResponse,
	WatchQueryResponse,
	WatchResponse,
	WatchServerConfig,
	WatchSocketMessage,
	WatchStatusResponse,
} from "./types";
import { DEFAULT_WATCH_SERVER_CONFIG } from "./types";

interface SocketData {
	clientId: string;
}

interface WatchClient {
	socket: import("bun").ServerWebSocket<SocketData>;
	connectedAt: number;
}

export class WatchServer {
	private server: import("bun").Server<SocketData> | null = null;
	private bonjourProcess: ChildProcess | null = null;
	private clients = new Map<string, WatchClient>();
	private config: WatchServerConfig;
	private stateChangeListener: ((state: DaemonStateEnum) => void) | null = null;
	private transcriptionUpdateListener: ((text: string) => void) | null = null;
	private cancelledListener: (() => void) | null = null;
	private errorListener: ((error: Error) => void) | null = null;
	private queryListeners = new Map<
		string,
		{ onToken: (token: string) => void; onComplete: () => void; onError: (error: Error) => void }
	>();

	constructor(config: Partial<WatchServerConfig> = {}) {
		this.config = { ...DEFAULT_WATCH_SERVER_CONFIG, ...config };
	}

	start(): void {
		if (this.server) {
			debug.warn("watch-server", "Already running");
			return;
		}

		this.server = Bun.serve<SocketData>({
			port: this.config.port,
			hostname: this.config.host,
			fetch: (request, server) => this.handleHttp(request, server),
			websocket: {
				open: (ws) => this.handleWsOpen(ws),
				message: (ws, message) => this.handleWsMessage(ws, message),
				close: (ws) => this.handleWsClose(ws),
			},
		});
		this.startBonjourAdvertisement();

		this.stateChangeListener = () => this.broadcastToAll(this.buildStatusPayload());
		this.transcriptionUpdateListener = () => this.broadcastToAll(this.buildStatusPayload());
		this.cancelledListener = () => this.broadcastToAll(this.buildStatusPayload());
		this.errorListener = (error) => {
			this.broadcastToAll({ type: "error", message: error.message } as WatchErrorResponse);
			this.broadcastToAll(this.buildStatusPayload());
		};
		daemonEvents.on("stateChange", this.stateChangeListener);
		daemonEvents.on("transcriptionUpdate", this.transcriptionUpdateListener);
		daemonEvents.on("cancelled", this.cancelledListener);
		daemonEvents.on("error", this.errorListener);

		debug.info("watch-server", `Listening on ${this.config.host}:${this.config.port}`);
	}

	stop(): void {
		if (!this.server) return;

		for (const [, client] of this.clients) {
			try {
				client.socket.close(1000, "Server shutting down");
			} catch {
				/* ignore */
			}
		}
		this.clients.clear();
		this.queryListeners.clear();
		if (this.stateChangeListener) daemonEvents.off("stateChange", this.stateChangeListener);
		if (this.transcriptionUpdateListener) {
			daemonEvents.off("transcriptionUpdate", this.transcriptionUpdateListener);
		}
		if (this.cancelledListener) daemonEvents.off("cancelled", this.cancelledListener);
		if (this.errorListener) daemonEvents.off("error", this.errorListener);
		this.stateChangeListener = null;
		this.transcriptionUpdateListener = null;
		this.cancelledListener = null;
		this.errorListener = null;

		this.server.stop(true);
		this.server = null;
		this.stopBonjourAdvertisement();
		debug.info("watch-server", "Stopped");
	}

	get isRunning(): boolean {
		return this.server !== null;
	}

	get port(): number {
		return this.config.port;
	}

	private handleHttp(
		request: Request,
		server: import("bun").Server<SocketData>
	): Response | Promise<Response> | undefined {
		const url = new URL(request.url);

		// WebSocket upgrade
		if (url.pathname === "/ws" && request.headers.get("upgrade") === "websocket") {
			if (!this.isAuthorized(request)) {
				return new Response("Unauthorized", { status: 401 });
			}
			const upgraded = server.upgrade(request, {
				data: { clientId: randomUUID() },
			});
			if (upgraded) return undefined;
			return new Response("WebSocket upgrade failed", { status: 400 });
		}

		// CORS preflight
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: this.corsHeaders(),
			});
		}

		// REST API endpoints
		if (url.pathname === "/api/status" && request.method === "GET") {
			if (!this.isAuthorized(request)) {
				return this.jsonResponse({ type: "error", message: "Unauthorized" }, 401);
			}
			return this.jsonResponse(this.buildStatusPayload());
		}

		if (url.pathname === "/api/command" && request.method === "POST") {
			if (!this.isAuthorized(request)) {
				return this.jsonResponse({ type: "error", message: "Unauthorized" }, 401);
			}
			return this.handleCommand(request);
		}

		if (url.pathname === "/api/history" && request.method === "GET") {
			if (!this.isAuthorized(request)) {
				return this.jsonResponse({ type: "error", message: "Unauthorized" }, 401);
			}
			return this.jsonResponse(this.buildHistoryPayload());
		}

		if (url.pathname === "/health" && request.method === "GET") {
			return this.jsonResponse({
				ok: true,
				server: "orpheus-watch",
				version: "0.1.0",
				requiresPairingToken: Boolean(this.config.pairingToken),
				bonjourService: "_orpheus-watch._tcp.",
			});
		}

		return new Response("Not found", { status: 404, headers: this.corsHeaders() });
	}

	private handleWsOpen(ws: import("bun").ServerWebSocket<SocketData>): void {
		const clientId = ws.data.clientId;
		this.clients.set(clientId, { socket: ws, connectedAt: Date.now() });
		debug.info("watch-server", `Client ${clientId} connected (${this.clients.size} total)`);

		// Send initial status
		this.sendToClient(clientId, this.buildStatusPayload());
	}

	private handleWsMessage(
		ws: import("bun").ServerWebSocket<SocketData>,
		message: string | Buffer
	): void {
		const clientId = ws.data.clientId;
		let command: WatchCommand;

		try {
			const text = typeof message === "string" ? message : message.toString("utf8");
			const envelope = JSON.parse(text) as WatchSocketMessage<WatchCommand>;
			command = envelope.payload;
		} catch {
			this.sendToClient(clientId, { type: "error", message: "Invalid JSON" } as WatchErrorResponse);
			return;
		}

		void this.processCommand(clientId, command)
			.then((response) => {
				if (command.type !== "query") {
					this.sendToClient(clientId, response);
				}
			})
			.catch((error) => {
				const err = error instanceof Error ? error : new Error(String(error));
				this.sendToClient(clientId, {
					type: "error",
					message: err.message,
				} as WatchErrorResponse);
			});
	}

	private isAuthorized(request: Request): boolean {
		if (!this.config.pairingToken) return true;
		const url = new URL(request.url);
		const token =
			request.headers.get("x-orpheus-watch-token") ?? url.searchParams.get("token") ?? undefined;
		return token === this.config.pairingToken;
	}

	private startBonjourAdvertisement(): void {
		if (process.platform !== "darwin") return;
		if (this.bonjourProcess) return;

		try {
			this.bonjourProcess = spawn(
				"dns-sd",
				["-R", this.config.bonjourName, "_orpheus-watch._tcp", "local", String(this.config.port)],
				{ stdio: "ignore" }
			);
			this.bonjourProcess.once("exit", () => {
				this.bonjourProcess = null;
			});
		} catch (error) {
			debug.warn("watch-server", `Bonjour advertisement unavailable: ${String(error)}`);
		}
	}

	private stopBonjourAdvertisement(): void {
		if (!this.bonjourProcess) return;
		try {
			this.bonjourProcess.kill("SIGTERM");
		} catch {
			/* ignore */
		}
		this.bonjourProcess = null;
	}

	private handleWsClose(ws: import("bun").ServerWebSocket<SocketData>): void {
		const clientId = ws.data.clientId;
		this.clients.delete(clientId);
		debug.info("watch-server", `Client ${clientId} disconnected (${this.clients.size} remaining)`);
	}

	private async handleCommand(request: Request): Promise<Response> {
		let command: WatchCommand;
		try {
			command = (await request.json()) as WatchCommand;
		} catch {
			return this.jsonResponse(
				{ type: "error", message: "Invalid JSON body" } as WatchErrorResponse,
				400
			);
		}

		const result = await this.processCommand("rest", command);
		return this.jsonResponse(result);
	}

	private async processCommand(_clientId: string, command: WatchCommand): Promise<WatchResponse> {
		const manager = getDaemonManager();

		switch (command.type) {
			case "status": {
				return this.buildStatusPayload();
			}

			case "query": {
				if (!command.text.trim()) {
					return { type: "error", message: "Empty query" } as WatchErrorResponse;
				}

				// Set up streaming listeners for this query
				const queryId = randomUUID();
				let responseText = "";

				return new Promise((resolve) => {
					const onToken = (token: string): void => {
						responseText += token;
						this.broadcastToAll({
							type: "query",
							fragment: token,
							done: false,
						} as WatchQueryResponse);
					};

					const onComplete = (): void => {
						this.broadcastToAll({
							type: "query",
							fragment: "",
							done: true,
						} as WatchQueryResponse);
						resolve({
							type: "query",
							fragment: responseText,
							done: true,
						} as WatchQueryResponse);
					};

					const onError = (error: Error): void => {
						this.broadcastToAll({
							type: "query",
							fragment: "",
							done: true,
							error: error.message,
						} as WatchQueryResponse);
						resolve({
							type: "error",
							message: error.message,
						} as WatchErrorResponse);
					};

					this.queryListeners.set(queryId, { onToken, onComplete, onError });

					// Subscribe to events
					daemonEvents.on("responseToken", onToken);
					daemonEvents.on("responseComplete", onComplete);
					daemonEvents.on("error", onError);

					// Submit the query
					void manager.submitText(command.text).then(() => {
						// Cleanup listeners after a short delay to catch final events
						setTimeout(() => {
							daemonEvents.off("responseToken", onToken);
							daemonEvents.off("responseComplete", onComplete);
							daemonEvents.off("error", onError);
							this.queryListeners.delete(queryId);
						}, 5000);
					});
				});
			}

			case "audio": {
				if (!command.audioBase64.trim()) {
					return { type: "error", message: "Empty audio" } as WatchErrorResponse;
				}
				if (
					manager.state !== DaemonStateEnum.IDLE &&
					manager.state !== DaemonStateEnum.TYPING &&
					manager.state !== DaemonStateEnum.SPEAKING
				) {
					return { type: "error", message: "ORPHEUS is busy" } as WatchErrorResponse;
				}

				try {
					const audioBuffer = Buffer.from(command.audioBase64, "base64");
					void manager.submitAudio(audioBuffer, command.duration).catch((error) => {
						const err = error instanceof Error ? error : new Error(String(error));
						daemonEvents.emit("error", err);
					});
					return this.buildStatusPayload();
				} catch {
					return { type: "error", message: "Invalid audio payload" } as WatchErrorResponse;
				}
			}

			case "cancel": {
				manager.cancelCurrentAction();
				return this.buildStatusPayload();
			}

			case "speak": {
				if (command.text) {
					manager.submitText(command.text);
				}
				return this.buildStatusPayload();
			}

			case "listen": {
				if (manager.state === DaemonStateEnum.IDLE || manager.state === DaemonStateEnum.TYPING) {
					manager.startListening();
				} else if (manager.state === DaemonStateEnum.LISTENING) {
					void manager.stopListening();
				}
				return this.buildStatusPayload();
			}

			case "history": {
				return this.buildHistoryPayload();
			}

			default: {
				return { type: "error", message: "Unknown command type" } as WatchErrorResponse;
			}
		}
	}

	private buildStatusPayload(): WatchStatusResponse {
		const manager = getDaemonManager();
		return {
			type: "status",
			state: manager.state,
			transcription: manager.transcription || undefined,
			response: manager.response || undefined,
			connectedAt: Date.now(),
		};
	}

	private buildHistoryPayload(): WatchHistoryResponse {
		const manager = getDaemonManager();
		const history = manager.conversationHistory;

		const items: WatchHistoryResponse["items"] = [];
		for (let i = 0; i < history.length; i += 2) {
			const userMsg = history[i];
			const assistantMsg = history[i + 1];
			if (userMsg && userMsg.role === "user") {
				items.push({
					role: "user",
					content:
						typeof userMsg.content === "string" ? userMsg.content : JSON.stringify(userMsg.content),
					timestamp: Date.now() - (history.length - i) * 1000,
				});
			}
			if (assistantMsg && assistantMsg.role === "assistant") {
				items.push({
					role: "assistant",
					content:
						typeof assistantMsg.content === "string"
							? assistantMsg.content
							: JSON.stringify(assistantMsg.content),
					timestamp: Date.now() - (history.length - i - 1) * 1000,
				});
			}
		}

		return { type: "history", items };
	}

	private sendToClient(clientId: string, payload: WatchResponse): void {
		const client = this.clients.get(clientId);
		if (!client) return;

		const envelope: WatchSocketMessage = {
			id: randomUUID(),
			timestamp: Date.now(),
			payload,
		};

		try {
			client.socket.send(JSON.stringify(envelope));
		} catch (error) {
			debug.error("watch-server", `Failed to send to ${clientId}: ${String(error)}`);
		}
	}

	private broadcastToAll(payload: WatchResponse): void {
		const envelope: WatchSocketMessage = {
			id: randomUUID(),
			timestamp: Date.now(),
			payload,
		};
		const json = JSON.stringify(envelope);

		for (const [, client] of this.clients) {
			try {
				client.socket.send(json);
			} catch {
				/* client may have disconnected */
			}
		}
	}

	private jsonResponse(body: unknown, status = 200): Response {
		return new Response(JSON.stringify(body), {
			status,
			headers: {
				"Content-Type": "application/json",
				...this.corsHeaders(),
			},
		});
	}

	private corsHeaders(): Record<string, string> {
		if (!this.config.corsOrigin) return {};
		return {
			"Access-Control-Allow-Origin": this.config.corsOrigin,
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		};
	}
}

let serverInstance: WatchServer | null = null;

export function startWatchServer(config?: Partial<WatchServerConfig>): WatchServer {
	if (serverInstance) return serverInstance;
	serverInstance = new WatchServer(config);
	serverInstance.start();
	return serverInstance;
}

export function stopWatchServer(): void {
	serverInstance?.stop();
	serverInstance = null;
}

export function getWatchServer(): WatchServer | null {
	return serverInstance;
}
