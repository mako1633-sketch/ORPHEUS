function getStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
		if (typeof value === "number") return String(value);
	}
	return undefined;
}

function getNestedBodyMessage(value: unknown): string | undefined {
	if (!value) return undefined;
	if (typeof value === "string") return value.trim() || undefined;
	if (typeof value !== "object") return undefined;

	const record = value as Record<string, unknown>;
	const direct = getStringField(record, ["message", "error", "detail", "details"]);
	if (direct) return direct;

	const nestedError = record.error;
	if (nestedError && typeof nestedError === "object") {
		return getNestedBodyMessage(nestedError);
	}

	return undefined;
}

function getProviderErrorDetails(error: unknown): string | undefined {
	if (!error || typeof error !== "object") return undefined;

	const record = error as Record<string, unknown>;
	const status = getStringField(record, ["statusCode", "status", "code"]);
	const statusText = getStringField(record, ["statusText"]);
	const bodyMessage = getNestedBodyMessage(record.responseBody ?? record.body ?? record.data ?? record.cause);

	const details = [status ? `HTTP ${status}` : undefined, statusText, bodyMessage].filter(
		(value): value is string => Boolean(value)
	);

	return details.length > 0 ? details.join(": ") : undefined;
}

export function normalizeProviderStreamError(error: unknown, providerLabel: string): Error {
	const fallback =
		error instanceof Error
			? error.message
			: error && typeof error === "object" && "message" in error
				? String((error as { message?: unknown }).message)
				: String(error);

	const details = getProviderErrorDetails(error);
	const base = details ?? fallback;
	const message =
		base.toLowerCase() === "bad request" ? `${providerLabel} rejected the request: ${base}` : base;

	const normalized = new Error(message);
	if (error instanceof Error && error.stack) {
		normalized.stack = error.stack;
	}
	return normalized;
}

export function isTransientProviderStreamError(error: unknown): boolean {
	const normalized =
		error instanceof Error
			? error.message
			: error && typeof error === "object" && "message" in error
				? String((error as { message?: unknown }).message)
				: String(error);
	const details = getProviderErrorDetails(error);
	const text = `${normalized} ${details ?? ""}`.toLowerCase();

	return (
		text.includes("service unavailable") ||
		text.includes("temporarily unavailable") ||
		text.includes("overloaded") ||
		text.includes("rate limit") ||
		text.includes("timeout") ||
		text.includes("timed out") ||
		text.includes("econnreset") ||
		text.includes("socket hang up") ||
		text.includes("http 429") ||
		text.includes("http 500") ||
		text.includes("http 502") ||
		text.includes("http 503") ||
		text.includes("http 504")
	);
}

export function addTransientProviderContext(error: Error, providerLabel: string): Error {
	if (!isTransientProviderStreamError(error)) return error;
	if (error.message.toLowerCase().includes("transient provider/service issue")) return error;

	const wrapped = new Error(
		`Transient provider/service issue from ${providerLabel}: ${error.message}. The turn was preserved; retry or ask ORPHEUS to continue.`
	);
	wrapped.stack = error.stack;
	return wrapped;
}
