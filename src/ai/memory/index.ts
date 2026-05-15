/**
 * Memory module exports.
 * Includes both cloud-backed (mem0) and local (Ollama) memory systems,
 * plus the unified injection pipeline.
 */

export { getMemoryManager, isMemoryAvailable } from "./memory-manager";
export { buildMemoryInjection, getMemoryContextForMessage } from "./memory-injection";
export { getHonchoManager, isHonchoAvailable } from "./honcho-manager";
