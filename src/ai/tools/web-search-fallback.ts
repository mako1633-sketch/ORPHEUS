/**
 * Web search with fallback providers.
 * Primary: EXA (exa-js). Fallback: Brave API via fetch, then DuckDuckGo HTML scraping.
 * Results are normalized to a common format regardless of provider.
 */

import { tool } from "ai";
import { z } from "zod";
import { getExaClient, isExaAuthError, normalizeExaError } from "../exa-client";

const RecencyEnum = z.enum(["day", "week", "month", "year"]);

interface SearchResult {
	title: string;
	url: string;
	publishedDate?: string;
	source: "exa" | "brave" | "duckduckgo";
}

interface SearchProviderHealth {
	provider: string;
	healthy: boolean;
	lastChecked: string;
	error?: string;
}

let providerHealthCache: SearchProviderHealth[] = [];
let lastHealthCheck = 0;
const HEALTH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function recencyToStartDate(recency: z.infer<typeof RecencyEnum>): string {
	const now = new Date();
	switch (recency) {
		case "day":
			now.setDate(now.getDate() - 1);
			break;
		case "week":
			now.setDate(now.getDate() - 7);
			break;
		case "month":
			now.setMonth(now.getMonth() - 1);
			break;
		case "year":
			now.setFullYear(now.getFullYear() - 1);
			break;
	}
	return now.toISOString();
}

async function searchExa(
	query: string,
	numResults: number,
	recency?: z.infer<typeof RecencyEnum>,
	includeDomains?: string[]
): Promise<{ results: SearchResult[]; error?: string }> {
	const exaClientResult = getExaClient();
	if ("error" in exaClientResult) {
		return { results: [], error: exaClientResult.error };
	}

	try {
		const searchOptions: Record<string, unknown> = { numResults, type: "auto" };
		if (recency) searchOptions.startPublishedDate = recencyToStartDate(recency);
		if (includeDomains?.length) searchOptions.includeDomains = includeDomains;

		const rawData = (await exaClientResult.client.search(query, searchOptions)) as unknown as {
			results: Array<{ title?: string; url?: string; publishedDate?: string }>;
		};

		const results = (rawData.results ?? [])
			.map((r) => ({
				title: typeof r.title === "string" ? r.title : "",
				url: typeof r.url === "string" ? r.url : "",
				publishedDate: typeof r.publishedDate === "string" ? r.publishedDate : undefined,
				source: "exa" as const,
			}))
			.filter((r) => r.url);

		return { results };
	} catch (error) {
		const errorMessage = normalizeExaError(error);
		if (isExaAuthError(error)) {
			const { invalidateDaemonToolsCache } = await import("./index");
			const { invalidateSubagentToolsCache } = await import("./subagents");
			invalidateDaemonToolsCache();
			invalidateSubagentToolsCache();
		}
		return { results: [], error: errorMessage };
	}
}

async function searchBrave(
	query: string,
	numResults: number,
	recency?: z.infer<typeof RecencyEnum>,
	includeDomains?: string[]
): Promise<{ results: SearchResult[]; error?: string }> {
	const apiKey = process.env.BRAVE_API_KEY;
	if (!apiKey) {
		return { results: [], error: "BRAVE_API_KEY not set" };
	}

	try {
		const searchParams = new URLSearchParams({ q: query, count: String(Math.min(numResults, 20)) });
		if (includeDomains?.length) {
			for (const domain of includeDomains) searchParams.append("domain", domain);
		}

		const response = await fetch(
			`https://api.search.brave.com/res/v1/web/search?${searchParams.toString()}`,
			{
				headers: {
					Accept: "application/json",
					"X-Subscription-Token": apiKey,
				},
				signal: AbortSignal.timeout(10_000),
			}
		);

		if (!response.ok) {
			return { results: [], error: `Brave API HTTP ${response.status}` };
		}

		const data = (await response.json()) as {
			web?: {
				results?: Array<{ title?: string; url?: string; age?: string }>;
			};
		};

		const results = (data.web?.results ?? [])
			.map((r) => ({
				title: r.title ?? "",
				url: r.url ?? "",
				publishedDate: r.age ? new Date(Date.now() - parseAge(r.age)).toISOString() : undefined,
				source: "brave" as const,
			}))
			.filter((r) => r.url);

		return { results };
	} catch (error) {
		return { results: [], error: error instanceof Error ? error.message : String(error) };
	}
}

function parseAge(ageStr: string): number {
	// Convert "2 days ago" or "1 hour ago" to milliseconds
	const match = ageStr.match(/(\d+)\s*(day|hour|minute|second|week|month|year)s?/i);
	if (!match) return 0;
	const value = Number(match[1]);
	const unit = match[2]?.toLowerCase() ?? "";
	const multipliers: Record<string, number> = {
		second: 1000,
		minute: 60_000,
		hour: 3_600_000,
		day: 86_400_000,
		week: 604_800_000,
		month: 2_592_000_000,
		year: 31_536_000_000,
	};
	return value * (multipliers[unit] ?? 0);
}

async function searchDuckDuckGo(
	query: string,
	numResults: number
): Promise<{ results: SearchResult[]; error?: string }> {
	try {
		// DuckDuckGo Lite HTML scraping
		const params = new URLSearchParams({ q: query, kl: "en-us" });
		const response = await fetch(`https://lite.duckduckgo.com/lite/?${params.toString()}`, {
			signal: AbortSignal.timeout(10_000),
			headers: {
				"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
			},
		});

		if (!response.ok) {
			return { results: [], error: `DuckDuckGo HTTP ${response.status}` };
		}

		const html = await response.text();
		const results: SearchResult[] = [];

		// Simple regex extraction for DuckDuckGo Lite results
		const linkRegex = /<a[^>]+href="([^"]+)"[^>]*class="[^"]*result-link[^"]*"[^>]*>([^<]*)<\/a>/gi;
		let match: RegExpExecArray | null;
		while (true) {
			match = linkRegex.exec(html);
			if (match === null || results.length >= numResults) break;
			const url = match[1];
			const title = (match[2] ?? "")
				.replace(/&amp;/g, "&")
				.replace(/&lt;/g, "<")
				.replace(/&gt;/g, ">");
			if (url && !url.startsWith("/") && !url.startsWith("javascript:")) {
				results.push({ title, url, source: "duckduckgo" });
			}
		}

		return { results };
	} catch (error) {
		return { results: [], error: error instanceof Error ? error.message : String(error) };
	}
}

export async function checkSearchProviderHealth(): Promise<SearchProviderHealth[]> {
	const now = Date.now();
	if (now - lastHealthCheck < HEALTH_CACHE_TTL_MS && providerHealthCache.length > 0) {
		return providerHealthCache;
	}

	const results: SearchProviderHealth[] = [];

	// Check EXA
	const exaClient = getExaClient();
	if ("error" in exaClient) {
		results.push({
			provider: "exa",
			healthy: false,
			lastChecked: new Date().toISOString(),
			error: exaClient.error,
		});
	} else {
		results.push({ provider: "exa", healthy: true, lastChecked: new Date().toISOString() });
	}

	// Check Brave
	const braveKey = process.env.BRAVE_API_KEY;
	if (!braveKey) {
		results.push({
			provider: "brave",
			healthy: false,
			lastChecked: new Date().toISOString(),
			error: "BRAVE_API_KEY not set",
		});
	} else {
		try {
			const r = await fetch(
				"https://api.search.brave.com/res/v1/web/search?q=healthcheck&count=1",
				{
					headers: { Accept: "application/json", "X-Subscription-Token": braveKey },
					signal: AbortSignal.timeout(5000),
				}
			);
			results.push({
				provider: "brave",
				healthy: r.ok,
				lastChecked: new Date().toISOString(),
				error: r.ok ? undefined : `HTTP ${r.status}`,
			});
		} catch (e) {
			results.push({
				provider: "brave",
				healthy: false,
				lastChecked: new Date().toISOString(),
				error: e instanceof Error ? e.message : String(e),
			});
		}
	}

	// DuckDuckGo is always "available" (no API key needed)
	results.push({ provider: "duckduckgo", healthy: true, lastChecked: new Date().toISOString() });

	providerHealthCache = results;
	lastHealthCheck = now;
	return results;
}

export const webSearchWithFallback = tool({
	description:
		"Searches the web with automatic provider fallback. Primary: EXA. Fallback 1: Brave Search API (requires BRAVE_API_KEY). Fallback 2: DuckDuckGo web scraping (no key needed, slower, less reliable). Also includes a provider health check endpoint.",
	inputSchema: z.object({
		query: z.string().describe("The search query."),
		numResults: z.number().min(1).max(20).default(10).describe("Number of results to return."),
		recency: RecencyEnum.optional().describe(
			"Filter to recent results. Only honored by EXA and Brave."
		),
		includeDomains: z
			.array(z.string())
			.optional()
			.describe("Limit search to specific domains. Only honored by EXA and Brave."),
		action: z
			.enum(["search", "health"])
			.default("search")
			.describe("'search' to perform a search, 'health' to check provider status."),
	}),
	execute: async ({ query, numResults, recency, includeDomains, action }) => {
		if (action === "health") {
			const health = await checkSearchProviderHealth();
			return { success: true, data: { providers: health } };
		}

		// Try EXA first
		const exaResult = await searchExa(query, numResults, recency, includeDomains);
		if (exaResult.results.length > 0) {
			return { success: true, data: { results: exaResult.results, provider: "exa" } };
		}

		// Fallback to Brave
		const braveResult = await searchBrave(query, numResults, recency, includeDomains);
		if (braveResult.results.length > 0) {
			return { success: true, data: { results: braveResult.results, provider: "brave" } };
		}

		// Final fallback to DuckDuckGo
		const ddgResult = await searchDuckDuckGo(query, numResults);
		if (ddgResult.results.length > 0) {
			return { success: true, data: { results: ddgResult.results, provider: "duckduckgo" } };
		}

		// All failed — aggregate errors
		const errors = [exaResult.error, braveResult.error, ddgResult.error].filter(Boolean);
		return {
			success: false,
			error: `All search providers failed: ${errors.join("; ") || "unknown error"}`,
		};
	},
});
