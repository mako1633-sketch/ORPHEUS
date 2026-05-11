import { debug, memoryDebug } from "../../utils/debug-logger";
import { detectAssistantResponseLeak, isAssistantResponseGuardNotice } from "../assistant-response-guard";

const HONCHO_PACKAGE = "@honcho-ai/sdk";
const DEFAULT_WORKSPACE_ID = "orpheus";
const DEFAULT_USER_PEER_ID = "operator";
const DEFAULT_ASSISTANT_PEER_ID = "orpheus";

interface HonchoMessageLike {
	role?: string;
	content?: string;
}

interface HonchoContextResult {
	representation?: unknown;
	peer_card?: unknown;
	peerCard?: unknown;
	to_openai?: (options?: unknown) => HonchoMessageLike[];
	toOpenAI?: (options?: unknown) => HonchoMessageLike[];
}

interface HonchoPeerLike {
	id?: string;
	message: (content: string) => unknown;
	chat?: (query: string, options?: unknown) => Promise<unknown>;
	context?: (options?: unknown) => Promise<HonchoContextResult>;
	get_context?: (options?: unknown) => Promise<HonchoContextResult>;
}

interface HonchoSessionLike {
	id?: string;
	addPeers?: (peers: HonchoPeerLike[]) => Promise<unknown>;
	add_peers?: (peers: HonchoPeerLike[]) => Promise<unknown>;
	addMessages?: (messages: unknown[]) => Promise<unknown>;
	add_messages?: (messages: unknown[]) => Promise<unknown>;
	context?: (options?: unknown) => Promise<HonchoContextResult>;
	get_context?: (options?: unknown) => Promise<HonchoContextResult>;
}

interface HonchoClientLike {
	peer: (id: string) => HonchoPeerLike;
	session: (id: string) => HonchoSessionLike;
}

type HonchoConstructor = new (options?: Record<string, unknown>) => HonchoClientLike;
type HonchoFactory = () => Promise<HonchoConstructor>;

let honchoFactoryOverride: HonchoFactory | null = null;

function readEnv(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

function isTruthyEnv(value: string | undefined): boolean {
	if (!value) return false;
	return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function getSessionId(sessionId: string | null | undefined): string {
	const normalized = sessionId?.trim();
	return normalized ? `orpheus-${normalized}` : "orpheus-global";
}

function stringifyContextValue(value: unknown): string {
	if (Array.isArray(value)) {
		return value
			.map((entry) => String(entry).trim())
			.filter(Boolean)
			.join("\n");
	}
	if (typeof value === "string") return value.trim();
	if (value && typeof value === "object") {
		try {
			return JSON.stringify(value);
		} catch {
			return "";
		}
	}
	return "";
}

function textFromOpenAiMessages(messages: HonchoMessageLike[]): string {
	return messages
		.map((message) => {
			const role = message.role?.trim();
			const content = message.content?.trim();
			if (!content) return "";
			return role ? `${role}: ${content}` : content;
		})
		.filter(Boolean)
		.join("\n");
}

function formatContextResult(context: HonchoContextResult | null | undefined): string {
	if (!context) return "";

	const openAiMessages =
		typeof context.toOpenAI === "function"
			? context.toOpenAI()
			: typeof context.to_openai === "function"
				? context.to_openai()
				: undefined;
	const openAiText = Array.isArray(openAiMessages) ? textFromOpenAiMessages(openAiMessages) : "";

	const representation = stringifyContextValue(context.representation);
	const peerCard = stringifyContextValue(context.peerCard ?? context.peer_card);

	return [
		peerCard ? `Peer card:\n${peerCard}` : "",
		representation ? `Representation:\n${representation}` : "",
		openAiText,
	]
		.filter(Boolean)
		.join("\n\n")
		.trim();
}

function isContaminatedMemoryText(text: string): boolean {
	const trimmed = text.trim();
	return Boolean(
		trimmed && (detectAssistantResponseLeak(trimmed) || isAssistantResponseGuardNotice(trimmed))
	);
}

async function defaultHonchoFactory(): Promise<HonchoConstructor> {
	const mod = (await import(HONCHO_PACKAGE)) as { Honcho?: HonchoConstructor; default?: HonchoConstructor };
	const ctor = mod.Honcho ?? mod.default;
	if (!ctor) {
		throw new Error("Honcho SDK did not export Honcho");
	}
	return ctor;
}

export function isHonchoAvailable(): boolean {
	return Boolean(
		readEnv("HONCHO_API_KEY") || readEnv("HONCHO_BASE_URL") || isTruthyEnv(readEnv("HONCHO_ENABLED"))
	);
}

export function setHonchoFactoryForTesting(factory: HonchoFactory | null): void {
	honchoFactoryOverride = factory;
	HonchoManager.resetInstanceForTesting();
}

export class HonchoManager {
	private static instance: HonchoManager | null = null;
	private client: HonchoClientLike | null = null;
	private userPeer: HonchoPeerLike | null = null;
	private assistantPeer: HonchoPeerLike | null = null;
	private initPromise: Promise<void> | null = null;
	private peersAddedBySession = new Set<string>();
	private _isAvailable = false;

	private constructor() {}

	static getInstance(): HonchoManager {
		if (!HonchoManager.instance) {
			HonchoManager.instance = new HonchoManager();
		}
		return HonchoManager.instance;
	}

	static resetInstanceForTesting(): void {
		HonchoManager.instance = null;
	}

	get isAvailable(): boolean {
		return this._isAvailable;
	}

	async initialize(): Promise<boolean> {
		if (this.initPromise) {
			await this.initPromise;
			return this._isAvailable;
		}

		this.initPromise = this.doInitialize();
		await this.initPromise;
		return this._isAvailable;
	}

	private async doInitialize(): Promise<void> {
		if (!isHonchoAvailable()) {
			this._isAvailable = false;
			return;
		}

		try {
			const Honcho = await (honchoFactoryOverride ?? defaultHonchoFactory)();
			const options: Record<string, unknown> = {
				workspaceId: readEnv("HONCHO_WORKSPACE_ID") ?? DEFAULT_WORKSPACE_ID,
			};
			const apiKey = readEnv("HONCHO_API_KEY");
			const baseUrl = readEnv("HONCHO_BASE_URL");
			if (apiKey) options.apiKey = apiKey;
			if (baseUrl) options.baseURL = baseUrl;

			this.client = new Honcho(options);
			this.userPeer = this.client.peer(readEnv("HONCHO_USER_PEER_ID") ?? DEFAULT_USER_PEER_ID);
			this.assistantPeer = this.client.peer(readEnv("HONCHO_ASSISTANT_PEER_ID") ?? DEFAULT_ASSISTANT_PEER_ID);
			this._isAvailable = true;
			debug.info("honcho-init", {
				message: "Honcho initialized",
				workspaceId: options.workspaceId,
				baseUrl: baseUrl ?? null,
			});
		} catch (error) {
			this._isAvailable = false;
			debug.error("honcho-init", {
				message: "Honcho initialization failed",
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private getSession(sessionId: string | null | undefined): HonchoSessionLike | null {
		if (!this.client) return null;
		return this.client.session(getSessionId(sessionId));
	}

	private async ensureSessionPeers(session: HonchoSessionLike): Promise<void> {
		const sessionId = session.id ?? "unknown";
		if (this.peersAddedBySession.has(sessionId)) return;
		if (!this.userPeer || !this.assistantPeer) return;

		if (typeof session.addPeers === "function") {
			await session.addPeers([this.userPeer, this.assistantPeer]);
		} else if (typeof session.add_peers === "function") {
			await session.add_peers([this.userPeer, this.assistantPeer]);
		}
		this.peersAddedBySession.add(sessionId);
	}

	async addTurn(params: {
		sessionId?: string | null;
		userText: string;
		assistantText: string;
		metadata?: Record<string, unknown>;
	}): Promise<void> {
		if (!(await this.initialize()) || !this.userPeer || !this.assistantPeer) return;
		const userText = params.userText.trim();
		const assistantText = params.assistantText.trim();
		if (!userText || !assistantText) return;
		if (isContaminatedMemoryText(assistantText)) {
			memoryDebug.info("honcho-add-turn-skipped", {
				sessionId: getSessionId(params.sessionId),
				reason: "contaminated-assistant-text",
			});
			return;
		}

		const session = this.getSession(params.sessionId);
		if (!session) return;

		try {
			await this.ensureSessionPeers(session);
			const messages = [this.userPeer.message(userText), this.assistantPeer.message(assistantText)];
			if (typeof session.addMessages === "function") {
				await session.addMessages(messages);
			} else if (typeof session.add_messages === "function") {
				await session.add_messages(messages);
			} else {
				throw new Error("Honcho session does not support addMessages");
			}
			memoryDebug.info("honcho-add-turn", {
				sessionId: getSessionId(params.sessionId),
				metadata: params.metadata,
				userLength: userText.length,
				assistantLength: assistantText.length,
			});
		} catch (error) {
			debug.error("honcho-add-turn", {
				message: "Failed to add Honcho turn",
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	async buildContext(params: { sessionId?: string | null; query: string; tokens?: number }): Promise<string> {
		if (!(await this.initialize())) return "";
		const session = this.getSession(params.sessionId);
		if (!session || !this.userPeer || !this.assistantPeer) return "";

		try {
			await this.ensureSessionPeers(session);
			const context =
				typeof session.context === "function"
					? await session.context({ tokens: params.tokens ?? 1500 })
					: typeof session.get_context === "function"
						? await session.get_context({ tokens: params.tokens ?? 1500 })
						: null;
			const sessionContext = formatContextResult(context);

			const peerContext =
				typeof this.userPeer.context === "function"
					? await this.userPeer.context({
							target: this.assistantPeer.id ?? DEFAULT_ASSISTANT_PEER_ID,
							search_query: params.query,
						})
					: typeof this.userPeer.get_context === "function"
						? await this.userPeer.get_context({
								target: this.assistantPeer.id ?? DEFAULT_ASSISTANT_PEER_ID,
								search_query: params.query,
							})
						: null;
			const peerContextText = formatContextResult(peerContext);

			const chatContext =
				!sessionContext && !peerContextText && typeof this.userPeer.chat === "function"
					? stringifyContextValue(
							await this.userPeer.chat("What context is relevant to the user's current message?", {
								session: getSessionId(params.sessionId),
							})
						)
					: "";

			const result = [sessionContext, peerContextText, chatContext].filter(Boolean).join("\n\n").trim();
			if (isContaminatedMemoryText(result)) {
				debug.warn("honcho-context-skipped", {
					message: "Honcho returned contaminated context",
					sessionId: getSessionId(params.sessionId),
				});
				return "";
			}
			if (result) {
				debug.info("honcho-context", {
					message: "Retrieved Honcho context",
					sessionId: getSessionId(params.sessionId),
					length: result.length,
				});
			}
			return result;
		} catch (error) {
			debug.error("honcho-context", {
				message: "Failed to retrieve Honcho context",
				error: error instanceof Error ? error.message : String(error),
			});
			return "";
		}
	}
}

export function getHonchoManager(): HonchoManager {
	return HonchoManager.getInstance();
}
