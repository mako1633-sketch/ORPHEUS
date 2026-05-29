import type { FindEvilToolName } from "./types";

export interface McpToolDefinition {
	name: FindEvilToolName;
	title: string;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, unknown>;
		required?: string[];
	};
}

const offsetProperty = {
	type: "number",
	description: "Sleuth Kit partition offset in sectors, if required by the disk image.",
};

export const findEvilMcpTools: McpToolDefinition[] = [
	{
		name: "hash_evidence",
		title: "Hash Evidence",
		description: "Compute SHA-256 for the external disk image without modifying it.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "inspect_partitions",
		title: "Inspect Partitions",
		description: "Run mmls against the disk image and save the partition table output.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "list_files",
		title: "List Files",
		description: "Run fls recursively against the image, optionally with a partition offset.",
		inputSchema: {
			type: "object",
			properties: { offset: offsetProperty },
		},
	},
	{
		name: "extract_file_metadata",
		title: "Extract File Metadata",
		description: "Run istat for a specific inode and optional partition offset.",
		inputSchema: {
			type: "object",
			properties: {
				inode: { type: "string", description: "Filesystem inode to inspect." },
				offset: offsetProperty,
			},
			required: ["inode"],
		},
	},
	{
		name: "build_timeline",
		title: "Build Timeline",
		description: "Create an fls bodyfile and convert it with mactime.",
		inputSchema: {
			type: "object",
			properties: { offset: offsetProperty },
		},
	},
	{
		name: "search_indicators",
		title: "Search Indicators",
		description: "Search printable strings for analyst-provided indicators with capped results.",
		inputSchema: {
			type: "object",
			properties: {
				indicators: {
					type: "array",
					items: { type: "string" },
					description: "Indicator strings to search for.",
				},
				timeoutMs: { type: "number", description: "Optional command timeout in milliseconds." },
			},
			required: ["indicators"],
		},
	},
	{
		name: "summarize_findings",
		title: "Summarize Findings",
		description: "Generate a Markdown findings summary from the structured execution log.",
		inputSchema: {
			type: "object",
			properties: {
				notes: {
					type: "string",
					description: "Optional analyst notes or self-correction context to include.",
				},
			},
		},
	},
];

export function isFindEvilToolName(value: string): value is FindEvilToolName {
	return findEvilMcpTools.some((tool) => tool.name === value);
}
