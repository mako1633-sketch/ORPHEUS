/**
 * Memory module exports.
 * Includes both cloud-backed (mem0) and local (Ollama) memory systems,
 * plus the unified injection pipeline.
 */

export { getHonchoManager, isHonchoAvailable } from "./honcho-manager";
export { buildMemoryInjection, getMemoryContextForMessage } from "./memory-injection";
export { getMemoryManager, isMemoryAvailable } from "./memory-manager";
