import { afterEach, describe, expect, it } from "bun:test";
import {
	getHonchoManager,
	isHonchoAvailable,
	setHonchoFactoryForTesting,
} from "../src/ai/memory/honcho-manager";

const ORIGINAL_ENV = { ...process.env };

function resetEnv(): void {
	for (const key of Object.keys(process.env)) {
		if (!(key in ORIGINAL_ENV)) {
			delete process.env[key];
		}
	}
	for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
}

describe("HonchoManager", () => {
	afterEach(() => {
		setHonchoFactoryForTesting(null);
		resetEnv();
	});

	it("is disabled unless explicitly configured", () => {
		process.env.HONCHO_API_KEY = "";
		process.env.HONCHO_BASE_URL = "";
		process.env.HONCHO_ENABLED = "";

		expect(isHonchoAvailable()).toBe(false);
	});

	it("adds sanitized turns and retrieves context with a mocked SDK", async () => {
		process.env.HONCHO_ENABLED = "true";
		process.env.HONCHO_USER_PEER_ID = "operator";

		const addedMessages: unknown[][] = [];
		const addedPeers: unknown[][] = [];
		setHonchoFactoryForTesting(async () => {
			return class FakeHoncho {
				peer(id: string) {
					return {
						id,
						message: (content: string) => ({ peer: id, content }),
						context: async () => ({
							representation: `${id} remembers stable context`,
							peerCard: [`${id} card`],
						}),
					};
				}

				session(id: string) {
					return {
						id,
						addPeers: async (peers: unknown[]) => {
							addedPeers.push(peers);
						},
						addMessages: async (messages: unknown[]) => {
							addedMessages.push(messages);
						},
						context: async () => ({
							toOpenAI: () => [{ role: "system", content: `session ${id} context` }],
						}),
					};
				}
			};
		});

		const manager = getHonchoManager();
		await manager.addTurn({
			sessionId: "abc",
			userText: "User prefers concise answers",
			assistantText: "Noted.",
		});
		const context = await manager.buildContext({ sessionId: "abc", query: "concise" });

		expect(addedPeers.length).toBe(1);
		expect(addedMessages.length).toBe(1);
		expect(JSON.stringify(addedMessages[0])).toContain("User prefers concise answers");
		expect(context).toContain("session orpheus-abc context");
		expect(context).toContain("operator remembers stable context");
	});

	it("passes HONCHO_BASE_URL using the SDK's baseURL option", async () => {
		process.env.HONCHO_ENABLED = "true";
		process.env.HONCHO_API_KEY = "honcho-test-key";
		process.env.HONCHO_BASE_URL = "http://127.0.0.1:8000";

		let capturedOptions: Record<string, unknown> | undefined;
		setHonchoFactoryForTesting(async () => {
			return class FakeHoncho {
				constructor(options?: Record<string, unknown>) {
					capturedOptions = options;
				}

				peer(id: string) {
					return {
						id,
						message: (content: string) => ({ peer: id, content }),
					};
				}

				session(id: string) {
					return {
						id,
						addPeers: async () => {},
						addMessages: async () => {},
					};
				}
			};
		});

		await getHonchoManager().initialize();

		expect(capturedOptions?.apiKey).toBe("honcho-test-key");
		expect(capturedOptions?.baseURL).toBe("http://127.0.0.1:8000");
		expect(capturedOptions).not.toHaveProperty("baseUrl");
	});

	it("does not write leaked assistant tool plans into Honcho", async () => {
		process.env.HONCHO_ENABLED = "true";

		const addedMessages: unknown[][] = [];
		setHonchoFactoryForTesting(async () => {
			return class FakeHoncho {
				peer(id: string) {
					return {
						id,
						message: (content: string) => ({ peer: id, content }),
					};
				}

				session(id: string) {
					return {
						id,
						addPeers: async () => {},
						addMessages: async (messages: unknown[]) => {
							addedMessages.push(messages);
						},
					};
				}
			};
		});

		await getHonchoManager().addTurn({
			sessionId: "abc",
			userText: "Explain this security report.",
			assistantText:
				'Here\'s an example of a tool call using groundingManager:\nsubagent spawn "Explain the report" with tools( groundingManager ).',
		});

		expect(addedMessages.length).toBe(0);
	});

	it("drops contaminated Honcho context before prompt injection", async () => {
		process.env.HONCHO_ENABLED = "true";

		setHonchoFactoryForTesting(async () => {
			return class FakeHoncho {
				peer(id: string) {
					return {
						id,
						message: (content: string) => ({ peer: id, content }),
						context: async () => ({
							representation:
								'Here is the subagent execution and grounding details:\n{"toolName":"groundingManager","input":{}}',
						}),
					};
				}

				session(id: string) {
					return {
						id,
						addPeers: async () => {},
						context: async () => ({
							toOpenAI: () => [{ role: "system", content: "normal context" }],
						}),
					};
				}
			};
		});

		const context = await getHonchoManager().buildContext({ sessionId: "abc", query: "report" });

		expect(context).toBe("");
	});
});
