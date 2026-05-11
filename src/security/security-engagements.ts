import { promises as fs } from "node:fs";
import path from "node:path";
import { getAppConfigDir } from "../utils/preferences";
import { defaultDueDateForSeverity } from "./remediation-sla";
import type { AssessmentFinding } from "./windows-assessment-parser";
import type { WindowsAssessmentDiff, WindowsAssessmentRecord } from "./windows-assessment-history";

export type EngagementRiskTier = "unknown" | "low" | "medium" | "high";
export type EngagementStatus = "active" | "paused" | "closed";
export type RemediationLedgerStatus = "open" | "accepted-risk" | "in-progress" | "fixed" | "verified";

export interface ClientEngagement {
	id: string;
	clientName: string;
	slug: string;
	status: EngagementStatus;
	riskTier: EngagementRiskTier;
	contacts: string[];
	environmentNotes: string[];
	createdAt: string;
	updatedAt: string;
	lastAssessmentAt?: string;
	lastEvidencePackPath?: string;
}

export interface RemediationLedgerIssue {
	id: string;
	clientSlug: string;
	findingId: string;
	title: string;
	severity: AssessmentFinding["severity"];
	status: RemediationLedgerStatus;
	owner?: string;
	dueDate?: string;
	acceptedRiskReason?: string;
	acceptedRiskExpiresAt?: string;
	openedAt: string;
	updatedAt: string;
	verifiedAt?: string;
	lastSeenAssessmentId: string;
	firstSeenAssessmentId: string;
	evidence: string;
	risk: string;
	remediation: string;
	notes: string[];
}

export interface EngagementStore {
	clients: ClientEngagement[];
	ledger: RemediationLedgerIssue[];
}

export interface EngagementSyncResult {
	client: ClientEngagement;
	ledger: RemediationLedgerIssue[];
	openedIssueIds: string[];
	verifiedIssueIds: string[];
	unchangedIssueIds: string[];
}

const STORE_FILE_ENV = "ORPHEUS_SECURITY_ENGAGEMENTS_PATH";
const LEGACY_STORE_FILE_ENV = "DAEMON_SECURITY_ENGAGEMENTS_PATH";

export function slugifyClientName(value: string): string {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "client";
}

function getStorePath(): string {
	const override = process.env[STORE_FILE_ENV]?.trim();
	if (override) return override;
	const legacyOverride = process.env[LEGACY_STORE_FILE_ENV]?.trim();
	if (legacyOverride) return legacyOverride;
	return path.join(getAppConfigDir(), "security-engagements.json");
}

async function readStore(): Promise<EngagementStore> {
	try {
		const raw = await fs.readFile(getStorePath(), "utf8");
		const parsed = JSON.parse(raw) as Partial<EngagementStore>;
		return {
			clients: Array.isArray(parsed.clients) ? (parsed.clients as ClientEngagement[]) : [],
			ledger: Array.isArray(parsed.ledger) ? (parsed.ledger as RemediationLedgerIssue[]) : [],
		};
	} catch {
		return { clients: [], ledger: [] };
	}
}

async function writeStore(store: EngagementStore): Promise<void> {
	const storePath = getStorePath();
	await fs.mkdir(path.dirname(storePath), { recursive: true });
	await fs.writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

export async function listClientEngagements(): Promise<ClientEngagement[]> {
	return (await readStore()).clients;
}

export async function listRemediationLedger(clientName?: string): Promise<RemediationLedgerIssue[]> {
	const store = await readStore();
	if (!clientName) return store.ledger;
	const slug = slugifyClientName(clientName);
	return store.ledger.filter((issue) => issue.clientSlug === slug);
}

export async function upsertClientEngagement(params: {
	clientName: string;
	riskTier?: EngagementRiskTier;
	status?: EngagementStatus;
	contacts?: string[];
	environmentNotes?: string[];
	lastAssessmentAt?: string;
	lastEvidencePackPath?: string;
}): Promise<ClientEngagement> {
	const store = await readStore();
	const slug = slugifyClientName(params.clientName);
	const now = new Date().toISOString();
	const existing = store.clients.find((client) => client.slug === slug);
	const next: ClientEngagement = {
		id: existing?.id ?? crypto.randomUUID(),
		clientName: params.clientName.trim() || existing?.clientName || "Client",
		slug,
		status: params.status ?? existing?.status ?? "active",
		riskTier: params.riskTier ?? existing?.riskTier ?? "unknown",
		contacts: params.contacts ?? existing?.contacts ?? [],
		environmentNotes: params.environmentNotes ?? existing?.environmentNotes ?? [],
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		lastAssessmentAt: params.lastAssessmentAt ?? existing?.lastAssessmentAt,
		lastEvidencePackPath: params.lastEvidencePackPath ?? existing?.lastEvidencePackPath,
	};

	store.clients = existing
		? store.clients.map((client) => (client.slug === slug ? next : client))
		: [next, ...store.clients];
	await writeStore(store);
	return next;
}

function issueId(clientSlug: string, findingId: string): string {
	return `${clientSlug}:${findingId}`;
}

function riskTierFromFindings(findings: AssessmentFinding[]): EngagementRiskTier {
	if (findings.some((finding) => finding.severity === "high")) return "high";
	if (findings.some((finding) => finding.severity === "medium")) return "medium";
	if (findings.some((finding) => finding.severity === "low")) return "low";
	return "unknown";
}

export async function syncRemediationLedgerFromAssessment(params: {
	clientName: string;
	record: WindowsAssessmentRecord;
	diff: WindowsAssessmentDiff;
	findings: AssessmentFinding[];
	evidencePackPath?: string;
}): Promise<EngagementSyncResult> {
	const store = await readStore();
	const slug = slugifyClientName(params.clientName);
	const now = new Date().toISOString();
	const currentIds = new Set(params.findings.map((finding) => finding.id));
	const openedIssueIds: string[] = [];
	const verifiedIssueIds: string[] = [];
	const unchangedIssueIds: string[] = [];
	const existingClient = store.clients.find((client) => client.slug === slug);
	const client: ClientEngagement = {
		id: existingClient?.id ?? crypto.randomUUID(),
		clientName: params.clientName.trim() || existingClient?.clientName || "Client",
		slug,
		status: existingClient?.status ?? "active",
		riskTier: riskTierFromFindings(params.findings),
		contacts: existingClient?.contacts ?? [],
		environmentNotes: existingClient?.environmentNotes ?? [],
		createdAt: existingClient?.createdAt ?? now,
		updatedAt: now,
		lastAssessmentAt: params.record.createdAt,
		lastEvidencePackPath: params.evidencePackPath ?? existingClient?.lastEvidencePackPath,
	};

	const nextLedger = store.ledger.map((issue) => {
		if (issue.clientSlug !== slug) return issue;
		if (currentIds.has(issue.findingId)) {
			unchangedIssueIds.push(issue.id);
			return {
				...issue,
				status: issue.status === "verified" ? "open" : issue.status,
				updatedAt: now,
				lastSeenAssessmentId: params.record.id,
			};
		}
		if (issue.status !== "verified" && issue.status !== "accepted-risk") {
			verifiedIssueIds.push(issue.id);
			return {
				...issue,
				status: "verified" as const,
				updatedAt: now,
				verifiedAt: now,
				notes: [
					...issue.notes,
					`Verified resolved by assessment ${params.record.id} on ${params.record.createdAt}.`,
				],
			};
		}
		return issue;
	});

	for (const finding of params.findings) {
		const id = issueId(slug, finding.id);
		if (nextLedger.some((issue) => issue.id === id)) continue;
		openedIssueIds.push(id);
		nextLedger.push({
			id,
			clientSlug: slug,
			findingId: finding.id,
			title: finding.title,
			severity: finding.severity,
			status: "open",
			dueDate: defaultDueDateForSeverity(finding.severity, now),
			openedAt: now,
			updatedAt: now,
			firstSeenAssessmentId: params.record.id,
			lastSeenAssessmentId: params.record.id,
			evidence: finding.evidence,
			risk: finding.risk,
			remediation: finding.remediation,
			notes: [`Opened from assessment ${params.record.id} on ${params.record.createdAt}.`],
		});
	}

	store.clients = existingClient
		? store.clients.map((item) => (item.slug === slug ? client : item))
		: [client, ...store.clients];
	store.ledger = nextLedger;
	await writeStore(store);

	return {
		client,
		ledger: nextLedger.filter((issue) => issue.clientSlug === slug),
		openedIssueIds,
		verifiedIssueIds,
		unchangedIssueIds,
	};
}
