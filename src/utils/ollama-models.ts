/**
 * Fetches and caches the live Ollama model list from the local Ollama API.
 * Endpoint: GET {OLLAMA_BASE_URL}/models (OpenAI-compatible v1/models)
 */

import { getOllamaBaseUrl } from "../ai/model-config";
import type { ModelOption } from "../types";
import { debug } from "./debug-logger";

interface OllamaApiModelItem {
	id?: string;
	name?: string;
	object?: string;
}

interface OllamaModelsResponse {
	data?: OllamaApiModelItem[];
	object?: string;
}

let inMemoryCache: { timestamp: number; models: ModelOption[] } | null = null;
const CACHE_TTL_MS = 60_000; // 1 minute — local models change frequently

function normalizeOllamaModels(items: OllamaApiModelItem[]): ModelOption[] {
	const models: ModelOption[] = [];
	const seen = new Set<string>();

	for (const item of items) {
		const id = typeof item.id === "string" ? item.id.trim() : "";
		if (!id) continue;
		if (seen.has(id)) continue;
		seen.add(id);

		const name =
			typeof item.name === "string" && item.name.trim().length > 0 ? item.name.trim() : id;

		models.push({ id, name });
	}

	return models.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getOllamaModels(options: { forceRefresh?: boolean } = {}): Promise<{
	models: ModelOption[];
	timestamp: number | null;
	fromCache: boolean;
}> {
	const now = Date.now();
	const forceRefresh = options.forceRefresh === true;

	if (!forceRefresh && inMemoryCache && now - inMemoryCache.timestamp < CACHE_TTL_MS) {
		return {
			models: inMemoryCache.models,
			timestamp: inMemoryCache.timestamp,
			fromCache: true,
		};
	}

	try {
		const baseUrl = getOllamaBaseUrl();
		// Ensure we hit the /v1/models endpoint (OpenAI-compat)
		const url = `${baseUrl}/models`;
		debug.log("Fetching Ollama model list from:", url);

		const response = await fetch(url, {
			headers: { "Content-Type": "application/json" },
			signal: AbortSignal.timeout(5000),
		});

		if (!response.ok) {
			throw new Error(`Ollama models API error: ${response.status}`);
		}

		const data = (await response.json()) as OllamaModelsResponse;
		const items = Array.isArray(data.data) ? data.data : [];

		const models = normalizeOllamaModels(items);
		if (models.length > 0) {
			inMemoryCache = { timestamp: now, models };
			return {
				models,
				timestamp: now,
				fromCache: false,
			};
		}
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error));
		debug.error("Failed to fetch Ollama models:", err);
	}

	return {
		models: inMemoryCache?.models ?? [],
		timestamp: inMemoryCache?.timestamp ?? null,
		fromCache: Boolean(inMemoryCache),
	};
}
