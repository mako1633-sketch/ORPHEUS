import Exa from "exa-js";

type ExaClient = InstanceType<typeof Exa>;

export const EXA_API_KEY_INVALID_MESSAGE =
	"EXA_API_KEY is invalid. Update it, then restart or re-enter the key.";

let cachedClient: ExaClient | null = null;
let cachedApiKey: string | null = null;
let invalidApiKey: string | null = null;

function getCurrentApiKey(): string | undefined {
	return process.env.EXA_API_KEY;
}

export function isExaAuthError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /invalid api key|unauthorized|forbidden|401|403/i.test(message);
}

export function markCurrentExaApiKeyInvalid(): void {
	const apiKey = getCurrentApiKey();
	if (!apiKey) return;
	invalidApiKey = apiKey;
	if (cachedApiKey === apiKey) {
		cachedApiKey = null;
		cachedClient = null;
	}
}

export function isCurrentExaApiKeyInvalid(): boolean {
	const apiKey = getCurrentApiKey();
	return Boolean(apiKey && invalidApiKey === apiKey);
}

export function normalizeExaError(error: unknown): string {
	if (isExaAuthError(error)) {
		markCurrentExaApiKeyInvalid();
		return EXA_API_KEY_INVALID_MESSAGE;
	}
	return error instanceof Error ? error.message : String(error);
}

export function resetExaClientForTests(): void {
	cachedClient = null;
	cachedApiKey = null;
	invalidApiKey = null;
}

export const getExaClient = (): { client: ExaClient } | { error: string } => {
	const apiKey = getCurrentApiKey();
	if (!apiKey) {
		return { error: "EXA_API_KEY environment variable is not set" };
	}

	if (isCurrentExaApiKeyInvalid()) {
		return { error: EXA_API_KEY_INVALID_MESSAGE };
	}

	if (cachedClient && cachedApiKey === apiKey) {
		return { client: cachedClient };
	}

	cachedApiKey = apiKey;
	cachedClient = new Exa(apiKey);
	return { client: cachedClient };
};
