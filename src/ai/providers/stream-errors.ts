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
