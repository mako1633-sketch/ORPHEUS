export type RedTeamScopeKind = "local-machine" | "application" | "network" | "cloud" | "domain";

export type RedTeamActivity =
	| "passive-recon"
	| "configuration-review"
	| "dependency-review"
	| "safe-service-fingerprinting"
	| "authenticated-validation"
	| "web-app-validation";

export type RedTeamForbiddenActivity =
	| "credential-theft"
	| "stealth"
	| "persistence"
	| "evasion"
	| "destructive-testing"
	| "third-party-targeting"
	| "exploit-chaining";

export interface RedTeamScopeInput {
	name: string;
	kind: RedTeamScopeKind;
	targets: string[];
	owner?: string;
	authorization?: string;
	startDate?: string;
	endDate?: string;
	allowedActivities?: RedTeamActivity[];
	forbiddenActivities?: RedTeamForbiddenActivity[];
	evidencePath?: string;
	notes?: string[];
}

export interface RedTeamScope {
	name: string;
	kind: RedTeamScopeKind;
	targets: string[];
	owner: string;
	authorization: string;
	startDate: string;
	endDate: string;
	allowedActivities: RedTeamActivity[];
	forbiddenActivities: RedTeamForbiddenActivity[];
	evidencePath: string;
	notes: string[];
	ready: boolean;
	missing: string[];
}

const DEFAULT_ALLOWED: RedTeamActivity[] = [
	"passive-recon",
	"configuration-review",
	"dependency-review",
];

const DEFAULT_FORBIDDEN: RedTeamForbiddenActivity[] = [
	"credential-theft",
	"stealth",
	"persistence",
	"evasion",
	"destructive-testing",
	"third-party-targeting",
	"exploit-chaining",
];

function unique<T>(items: T[]): T[] {
	return Array.from(new Set(items));
}

function normalizeList(items: string[]): string[] {
	return unique(items.map((item) => item.trim()).filter(Boolean));
}

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

export function buildRedTeamScope(input: RedTeamScopeInput): RedTeamScope {
	const name = input.name.trim();
	const targets = normalizeList(input.targets);
	const owner = input.owner?.trim() ?? "";
	const authorization = input.authorization?.trim() ?? "";
	const startDate = input.startDate?.trim() || todayIso();
	const endDate = input.endDate?.trim() || startDate;
	const allowedActivities = unique(input.allowedActivities ?? DEFAULT_ALLOWED);
	const forbiddenActivities = unique([...(input.forbiddenActivities ?? []), ...DEFAULT_FORBIDDEN]);
	const evidencePath =
		input.evidencePath?.trim() ||
		`security/red-team/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
	const notes = normalizeList(input.notes ?? []);

	const missing = [
		name ? null : "name",
		targets.length > 0 ? null : "targets",
		owner ? null : "owner",
		authorization ? null : "authorization",
		startDate ? null : "startDate",
		endDate ? null : "endDate",
	].filter((item): item is string => Boolean(item));

	return {
		name,
		kind: input.kind,
		targets,
		owner,
		authorization,
		startDate,
		endDate,
		allowedActivities,
		forbiddenActivities,
		evidencePath,
		notes,
		ready: missing.length === 0,
		missing,
	};
}

export function formatRedTeamScopeMarkdown(scope: RedTeamScope): string {
	return [
		`# Red Team Assessment Scope`,
		"",
		`Name: ${scope.name || "not set"}`,
		`Scope type: ${scope.kind}`,
		`Owner: ${scope.owner || "not set"}`,
		`Authorization: ${scope.authorization || "not set"}`,
		`Window: ${scope.startDate} to ${scope.endDate}`,
		`Evidence path: ${scope.evidencePath}`,
		`Ready: ${scope.ready ? "yes" : "no"}`,
		"",
		"## Targets",
		scope.targets.length > 0 ? scope.targets.map((target) => `- ${target}`).join("\n") : "- none",
		"",
		"## Allowed Activities",
		scope.allowedActivities.map((activity) => `- ${activity}`).join("\n"),
		"",
		"## Forbidden Activities",
		scope.forbiddenActivities.map((activity) => `- ${activity}`).join("\n"),
		"",
		"## Notes",
		scope.notes.length > 0 ? scope.notes.map((note) => `- ${note}`).join("\n") : "- none",
		"",
		"## Missing Items",
		scope.missing.length > 0 ? scope.missing.map((item) => `- ${item}`).join("\n") : "- none",
	].join("\n");
}
