import { callFindEvilTool, createFindEvilContext } from "./core";
import { findEvilMcpTools, isFindEvilToolName } from "./mcp-schema";

const PROTOCOL_VERSION = "2025-11-25";

type JsonRpcRequest = {
	jsonrpc?: "2.0";
	id?: string | number | null;
	method?: string;
	params?: Record<string, unknown>;
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
	return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string, data?: unknown) {
	return { jsonrpc: "2.0", id, error: { code, message, data } };
}

async function handleRpc(request: JsonRpcRequest) {
	const id = request.id ?? null;

	if (request.method === "initialize") {
		return rpcResult(id, {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: { tools: { listChanged: false } },
			serverInfo: {
				name: "orpheus-find-evil-sift",
				version: "0.1.0",
				title: "ORPHEUS FIND EVIL SIFT MCP",
			},
			instructions:
				"Read-only disk-image triage tools for FIND EVIL. Set ORPHEUS_FIND_EVIL_IMAGE and ORPHEUS_FIND_EVIL_CASE_ID before calling tools.",
		});
	}

	if (request.method === "notifications/initialized") {
		return null;
	}

	if (request.method === "tools/list") {
		return rpcResult(id, {
			tools: findEvilMcpTools.map((tool) => ({
				name: tool.name,
				title: tool.title,
				description: tool.description,
				inputSchema: tool.inputSchema,
				annotations: { title: tool.title },
			})),
		});
	}

	if (request.method === "tools/call") {
		const params = request.params ?? {};
		const name = typeof params.name === "string" ? params.name : "";
		if (!isFindEvilToolName(name)) {
			return rpcError(id, -32602, `Unknown FIND EVIL tool: ${name}`);
		}
		const input =
			typeof params.arguments === "object" && params.arguments !== null
				? (params.arguments as Record<string, unknown>)
				: {};

		try {
			const ctx = await createFindEvilContext();
			const toolResult = await callFindEvilTool(ctx, name, input);
			return rpcResult(id, {
				content: [{ type: "text", text: JSON.stringify(toolResult, null, 2) }],
				structuredContent: toolResult,
				isError: !toolResult.success,
			});
		} catch (error) {
			return rpcError(id, -32000, error instanceof Error ? error.message : String(error));
		}
	}

	return rpcError(id, -32601, `Unsupported method: ${request.method ?? "(missing)"}`);
}

export function startFindEvilMcpServer(port = Number(process.env.PORT ?? 3333)) {
	return Bun.serve({
		port,
		async fetch(req) {
			const url = new URL(req.url);
			if (url.pathname !== "/mcp") {
				return new Response("Not found", { status: 404 });
			}

			if (req.method === "GET") {
				return new Response("SSE stream not used by this server", { status: 405 });
			}

			if (req.method === "DELETE") {
				return new Response(null, { status: 202 });
			}

			if (req.method !== "POST") {
				return new Response("Method not allowed", { status: 405 });
			}

			let payload: JsonRpcRequest | JsonRpcRequest[];
			try {
				payload = (await req.json()) as JsonRpcRequest | JsonRpcRequest[];
			} catch {
				return jsonResponse(rpcError(null, -32700, "Invalid JSON"), 400);
			}

			const messages = Array.isArray(payload) ? payload : [payload];
			const responses = await Promise.all(messages.map(handleRpc));
			const responseMessages = responses.filter(Boolean);
			if (responseMessages.length === 0) {
				return new Response(null, { status: 202 });
			}
			return jsonResponse(Array.isArray(payload) ? responseMessages : responseMessages[0]);
		},
	});
}

if (import.meta.main) {
	const server = startFindEvilMcpServer();
	console.log(`ORPHEUS FIND EVIL MCP server listening at http://localhost:${server.port}/mcp`);
}
