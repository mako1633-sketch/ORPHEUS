/**
 * ORPHEUS Watch Server — shared types for the companion model.
 * The watch app connects to this local server on the Mac.
 */

import type { DaemonState, TokenUsage } from "../types";

/** Command sent from the watch to ORPHEUS */
export type WatchCommand =
	| { type: "query"; text: string }
	| { type: "audio"; audioBase64: string; mimeType?: string; duration?: number }
	| { type: "cancel" }
	| { type: "status" }
	| { type: "history" }
	| { type: "speak"; text: string }
	| { type: "listen" };

/** Response sent from ORPHEUS to the watch */
export type WatchResponse =
	| WatchStatusResponse
	| WatchQueryResponse
	| WatchHistoryResponse
	| WatchErrorResponse;

/** Current daemon status snapshot */
export interface WatchStatusResponse {
	type: "status";
	state: DaemonState;
	transcription?: string;
	response?: string;
	usage?: TokenUsage;
	connectedAt: number;
}

/** Streaming response fragment */
export interface WatchQueryResponse {
	type: "query";
	fragment: string;
	done: boolean;
	error?: string;
}

/** Conversation history (last N turns) */
export interface WatchHistoryResponse {
	type: "history";
	items: Array<{
		role: "user" | "assistant";
		content: string;
		timestamp: number;
	}>;
}

/** Error response */
export interface WatchErrorResponse {
	type: "error";
	message: string;
}

/** WebSocket message envelope */
export interface WatchSocketMessage<T = unknown> {
	id: string;
	timestamp: number;
	payload: T;
}

/** Server configuration */
export interface WatchServerConfig {
	port: number;
	host: string;
	corsOrigin: string | null;
	pairingToken?: string;
	bonjourName: string;
}

export const DEFAULT_WATCH_SERVER_CONFIG: WatchServerConfig = {
	port: 8472,
	host: "0.0.0.0",
	corsOrigin: null,
	pairingToken: process.env.ORPHEUS_WATCH_TOKEN,
	bonjourName: "ORPHEUS",
};
