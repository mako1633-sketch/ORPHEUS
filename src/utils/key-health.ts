export type KeyHealthStatus = "configured" | "missing" | "invalid-format";

export interface KeyHealth {
	name: string;
	status: KeyHealthStatus;
	message: string;
}

function validateKey(name: string, value: string | undefined, pattern?: RegExp): KeyHealth {
	if (!value?.trim()) {
		return { name, status: "missing", message: `${name} is not configured.` };
	}
	if (pattern && !pattern.test(value.trim())) {
		return {
			name,
			status: "invalid-format",
			message: `${name} is present but does not match the expected prefix.`,
		};
	}
	return { name, status: "configured", message: `${name} is configured.` };
}

export function getKeyHealth(env: NodeJS.ProcessEnv = process.env): KeyHealth[] {
	return [
		validateKey("OPENAI_API_KEY", env.OPENAI_API_KEY, /^sk-/),
		validateKey("OPENROUTER_API_KEY", env.OPENROUTER_API_KEY, /^sk-or-/),
		validateKey("EXA_API_KEY", env.EXA_API_KEY),
	];
}
