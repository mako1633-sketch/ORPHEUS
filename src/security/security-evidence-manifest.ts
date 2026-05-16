import { createHash } from "node:crypto";
import type { SecurityControlMapping } from "./security-control-mapping";
import type { SecurityEvidencePackInput } from "./security-evidence-pack";

export interface EvidenceManifestArtifact {
	path: string;
	sha256: string;
	bytes: number;
}

export interface SecurityEvidenceManifest {
	version: 1;
	generatedAt: string;
	clientName: string;
	assessmentRecordId: string;
	playbookId: string;
	score: number;
	risk: string;
	commandSha256: string;
	commandOutputPreviewSha256: string;
	artifacts: EvidenceManifestArtifact[];
	controlMappingSummary: Record<string, number>;
}

export function sha256Hex(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

export function buildSecurityEvidenceManifest(params: {
	input: SecurityEvidencePackInput;
	markdown: string;
	markdownPath: string;
	portalHtml?: string;
	portalPath?: string;
	controlMappings: SecurityControlMapping[];
	generatedAt: Date;
}): SecurityEvidenceManifest {
	const artifacts: EvidenceManifestArtifact[] = [
		{
			path: params.markdownPath,
			sha256: sha256Hex(params.markdown),
			bytes: Buffer.byteLength(params.markdown, "utf8"),
		},
	];

	if (params.portalHtml && params.portalPath) {
		artifacts.push({
			path: params.portalPath,
			sha256: sha256Hex(params.portalHtml),
			bytes: Buffer.byteLength(params.portalHtml, "utf8"),
		});
	}

	const controlMappingSummary = params.controlMappings.reduce<Record<string, number>>(
		(summary, mapping) => {
			summary[mapping.status] = (summary[mapping.status] ?? 0) + 1;
			return summary;
		},
		{}
	);

	return {
		version: 1,
		generatedAt: params.generatedAt.toISOString(),
		clientName: params.input.clientName,
		assessmentRecordId: params.input.history.record.id,
		playbookId: params.input.playbookId,
		score: params.input.report.score,
		risk: params.input.report.risk,
		commandSha256: sha256Hex(params.input.command),
		commandOutputPreviewSha256: sha256Hex(params.input.commandOutput.trim().slice(0, 6000)),
		artifacts,
		controlMappingSummary,
	};
}
