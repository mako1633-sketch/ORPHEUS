/**
 * ORPHEUS Watch Server — public API entry point.
 */

export { getWatchServer, startWatchServer, stopWatchServer, WatchServer } from "./server";
export type {
	WatchCommand,
	WatchErrorResponse,
	WatchHistoryResponse,
	WatchQueryResponse,
	WatchResponse,
	WatchServerConfig,
	WatchSocketMessage,
	WatchStatusResponse,
} from "./types";
export { DEFAULT_WATCH_SERVER_CONFIG } from "./types";
