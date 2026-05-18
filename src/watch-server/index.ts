/**
 * ORPHEUS Watch Server — public API entry point.
 */

export { startWatchServer, stopWatchServer, getWatchServer, WatchServer } from "./server";
export type {
	WatchCommand,
	WatchResponse,
	WatchStatusResponse,
	WatchQueryResponse,
	WatchHistoryResponse,
	WatchErrorResponse,
	WatchSocketMessage,
	WatchServerConfig,
} from "./types";
export { DEFAULT_WATCH_SERVER_CONFIG } from "./types";
