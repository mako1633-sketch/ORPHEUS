/**
 * Fetches and caches the live Ollama model list from the local Ollama API.
 * Primary endpoint: GET {OLLAMA_BASE_URL}/models (OpenAI-compatible v1/models)
 * Fallback endpoint: GET {OLLAMA_API_BASE_URL}/api/tags (native Ollama)
 */

import { getOllamaBaseUrl } from "../ai/model-config";
import type { ModelOption } from "../types";
import { debug } from "./debug-logger";
import { withOllamaReasoningCapabilities } from "./ollama-model-capabilities";

interface OllamaApiModelItem {
	id?: string;
	name?: string;
	object?: string;
}

interface OllamaModelsResponse {
	data?: OllamaApiModelItem[];
	object?: string;
}

interface OllamaNativeModelItem {
	name?: string;
	model?: string;
}

interface OllamaNativeModelsResponse {
	models?: OllamaNativeModelItem[];
}

let inMemoryCache: { timestamp: number; models: ModelOption[] } | null = null;
const CACHE_TTL_MS = 60_000; // 1 minute — local models change frequently

function getOllamaApiBaseUrl(): string {
	return getOllamaBaseUrl()
		.replace(/\/v1\/?$/, "")
		.replace(/\/$/, "");
}

function normalizeModelIds(ids: string[]): ModelOption[] {
	const models: ModelOption[] = [];
	const seen = new Set<string>();

	for (const rawId of ids) {
		const id = rawId.trim();
		if (!id) continue;
		if (seen.has(id)) continue;
		seen.add(id);

		models.push(withOllamaReasoningCapabilities({ id, name: id }));
	}

	return models.sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeOllamaModels(items: OllamaApiModelItem[]): ModelOption[] {
	const models = normalizeModelIds(
		items.map((item) => (typeof item.id === "string" ? item.id : ""))
	);
	const namesById = new Map(
		items
			.filter((item) => typeof item.id === "string" && typeof item.name === "string")
			.map((item) => [item.id?.trim() ?? "", item.name?.trim() ?? ""])
	);

	return models.map((model) => {
		const name = namesById.get(model.id);
		return name ? withOllamaReasoningCapabilities({ ...model, name }) : model;
	});
}

function normalizeNativeOllamaModels(items: OllamaNativeModelItem[]): ModelOption[] {
	return normalizeModelIds(
		items.map((item) => {
			if (typeof item.name === "string") return item.name;
			if (typeof item.model === "string") return item.model;
			return "";
		})
	);
}

async function fetchOpenAiCompatibleModels(): Promise<ModelOption[]> {
	const baseUrl = getOllamaBaseUrl();
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

	return normalizeOllamaModels(items);
}

async function fetchNativeModels(): Promise<ModelOption[]> {
	const url = `${getOllamaApiBaseUrl()}/api/tags`;
	debug.log("Fetching native Ollama model list from:", url);

	const response = await fetch(url, {
		headers: { "Content-Type": "application/json" },
		signal: AbortSignal.timeout(5000),
	});

	if (!response.ok) {
		throw new Error(`Ollama native models API error: ${response.status}`);
	}

	const data = (await response.json()) as OllamaNativeModelsResponse;
	const items = Array.isArray(data.models) ? data.models : [];

	return normalizeNativeOllamaModels(items);
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
		let models = await fetchOpenAiCompatibleModels();
		if (models.length === 0) {
			models = await fetchNativeModels();
		}
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

		try {
			const models = await fetchNativeModels();
			if (models.length > 0) {
				inMemoryCache = { timestamp: now, models };
				return {
					models,
					timestamp: now,
					fromCache: false,
				};
			}
		} catch (nativeError) {
			const nativeErr = nativeError instanceof Error ? nativeError : new Error(String(nativeError));
			debug.error("Failed to fetch native Ollama models:", nativeErr);
		}
	}

	return {
		models: inMemoryCache?.models ?? [],
		timestamp: inMemoryCache?.timestamp ?? null,
		fromCache: Boolean(inMemoryCache),
	};
}
