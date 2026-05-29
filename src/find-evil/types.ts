export type FindEvilToolName =
	| "hash_evidence"
	| "inspect_partitions"
	| "list_files"
	| "extract_file_metadata"
	| "build_timeline"
	| "search_indicators"
	| "summarize_findings";

export interface FindEvilArtifact {
	path: string;
	sha256?: string;
	bytes?: number;
}

export interface FindEvilToolResult {
	success: boolean;
	caseId: string;
	tool: FindEvilToolName;
	startedAt: string;
	finishedAt: string;
	inputs: Record<string, unknown>;
	artifacts: FindEvilArtifact[];
	summary: string;
	warnings: string[];
	error?: string;
}
