import type { RedTeamScope, RedTeamScopeKind } from "./red-team-scope";

export type RedTeamPlaybookId =
	| "localHostPosture"
	| "repoExposureReview"
	| "externalDomainRecon"
	| "networkServiceReview"
	| "webAppHeadersReview";

export type RedTeamPlaybookRisk = "passive" | "read-only" | "approval-required";

export interface RedTeamCheck {
	id: string;
	title: string;
	why: string;
	command?: string;
	requiresApproval: boolean;
}

export interface RedTeamPlaybook {
	id: RedTeamPlaybookId;
	title: string;
	description: string;
	scopeKinds: RedTeamScopeKind[];
	riskLevel: RedTeamPlaybookRisk;
	checks: RedTeamCheck[];
	disallowed: string[];
}

const LOCAL_CHECKS: RedTeamCheck[] = [
	{
		id: "osIdentity",
		title: "OS and host identity",
		why: "Establishes platform, kernel, hostname, and user context for local defensive assessment.",
		command: "uname -a; hostname; id",
		requiresApproval: false,
	},
	{
		id: "listeningServices",
		title: "Local listening services",
		why: "Shows local services that may expose attack surface without connecting to remote targets.",
		command: "lsof -nP -iTCP -sTCP:LISTEN",
		requiresApproval: true,
	},
	{
		id: "recentLogSignals",
		title: "Recent authentication and security signals",
		why: "Surfaces recent local security events without dumping secrets or private file contents.",
		command: "last -20",
		requiresApproval: true,
	},
];

const PLAYBOOKS: Record<RedTeamPlaybookId, RedTeamPlaybook> = {
	localHostPosture: {
		id: "localHostPosture",
		title: "Local host red-team readiness review",
		description:
			"Read-only local posture checks for defensive red-team prep on a machine owned by the operator.",
		scopeKinds: ["local-machine"],
		riskLevel: "read-only",
		checks: LOCAL_CHECKS,
		disallowed: [
			"credential dumping",
			"persistence setup",
			"security-tool disabling",
			"destructive file changes",
		],
	},
	repoExposureReview: {
		id: "repoExposureReview",
		title: "Application/repository exposure review",
		description:
			"Static review prompts and local commands for dependency, secret-pattern, and risky-config assessment.",
		scopeKinds: ["application"],
		riskLevel: "passive",
		checks: [
			{
				id: "packageInventory",
				title: "Dependency and script inventory",
				why: "Identifies dependency managers, lifecycle scripts, and package metadata that shape risk.",
				command:
					"find . -maxdepth 3 \\( -name package.json -o -name bun.lock -o -name package-lock.json -o -name pnpm-lock.yaml -o -name requirements.txt -o -name pyproject.toml -o -name go.mod -o -name Cargo.toml \\) -print",
				requiresApproval: false,
			},
			{
				id: "secretPatternReview",
				title: "Secret-pattern review",
				why: "Finds likely accidental credentials by filename and marker without decoding or exfiltrating secrets.",
				command:
					"find . -maxdepth 4 \\( -name '.env*' -o -name '*credential*' -o -name '*secret*' -o -name '*token*' \\) -print",
				requiresApproval: true,
			},
		],
		disallowed: [
			"secret extraction",
			"token validation",
			"credential replay",
			"exploit development",
		],
	},
	externalDomainRecon: {
		id: "externalDomainRecon",
		title: "External domain passive recon",
		description:
			"Passive DNS, HTTP metadata, and TLS posture collection for an explicitly authorized domain.",
		scopeKinds: ["domain"],
		riskLevel: "approval-required",
		checks: [
			{
				id: "dnsOverview",
				title: "DNS overview",
				why: "Collects basic DNS records for the authorized domain using normal resolver queries.",
				command: "dig TARGET_DOMAIN A AAAA MX TXT CAA",
				requiresApproval: true,
			},
			{
				id: "httpHeaders",
				title: "HTTP response headers",
				why: "Checks security headers and redirect posture without crawling or fuzzing.",
				command: "curl -fsSIL --max-time 10 https://TARGET_DOMAIN",
				requiresApproval: true,
			},
		],
		disallowed: [
			"subdomain brute force",
			"credential attacks",
			"exploit attempts",
			"rate-heavy scanning",
		],
	},
	networkServiceReview: {
		id: "networkServiceReview",
		title: "Authorized network service review",
		description:
			"Low-impact service visibility plan for an approved host or CIDR. Active probing requires explicit approval.",
		scopeKinds: ["network"],
		riskLevel: "approval-required",
		checks: [
			{
				id: "hostScopeConfirmation",
				title: "Host scope confirmation",
				why: "Records approved hostnames, IPs, or CIDRs before any active network validation.",
				requiresApproval: false,
			},
			{
				id: "safeTcpConnect",
				title: "Safe TCP connect check",
				why: "Validates explicitly named ports only, avoiding broad or stealthy scans.",
				command: "nc -vz TARGET_HOST TARGET_PORT",
				requiresApproval: true,
			},
		],
		disallowed: ["mass scanning", "stealth scanning", "exploit chaining", "lateral movement"],
	},
	webAppHeadersReview: {
		id: "webAppHeadersReview",
		title: "Web application header and surface review",
		description:
			"Low-impact web checks for an approved application URL, focused on headers and public metadata.",
		scopeKinds: ["application", "domain"],
		riskLevel: "approval-required",
		checks: [
			{
				id: "headers",
				title: "Security headers",
				why: "Reviews HTTP response headers for missing browser-side security controls.",
				command: "curl -fsSIL --max-time 10 TARGET_URL",
				requiresApproval: true,
			},
			{
				id: "robotsAndSecurityTxt",
				title: "Public metadata files",
				why: "Checks public policy and crawler files without authentication or fuzzing.",
				command:
					"curl -fsSL --max-time 10 TARGET_URL/robots.txt; curl -fsSL --max-time 10 TARGET_URL/.well-known/security.txt",
				requiresApproval: true,
			},
		],
		disallowed: ["fuzzing", "authentication bypass", "payload exploitation", "destructive testing"],
	},
};

export function listRedTeamPlaybooks(): RedTeamPlaybook[] {
	return Object.values(PLAYBOOKS);
}

export function getRedTeamPlaybook(id: RedTeamPlaybookId): RedTeamPlaybook {
	return PLAYBOOKS[id];
}

export function recommendRedTeamPlaybooks(scope: RedTeamScope): RedTeamPlaybook[] {
	if (!scope.ready) return [];
	return listRedTeamPlaybooks().filter((playbook) => playbook.scopeKinds.includes(scope.kind));
}

export function buildRedTeamPlaybookCommand(id: RedTeamPlaybookId): string {
	const playbook = getRedTeamPlaybook(id);
	return playbook.checks
		.filter((check) => Boolean(check.command))
		.map((check) => {
			const title = check.title.replace(/'/g, "''");
			return `printf '\\n### ${title}\\n'; ${check.command}`;
		})
		.join("; ");
}

export function buildRedTeamReportMarkdown(input: {
	scope: RedTeamScope;
	playbook: RedTeamPlaybook;
	evidence?: string;
	generatedAt?: Date;
}): string {
	const generatedAt = input.generatedAt ?? new Date();
	const evidence = input.evidence?.trim() || "No command output has been attached yet.";
	return [
		"# Red Team Assessment Report",
		"",
		`Prepared by: ORPHEUS`,
		`Generated at: ${generatedAt.toISOString()}`,
		`Assessment: ${input.scope.name}`,
		`Scope type: ${input.scope.kind}`,
		`Owner: ${input.scope.owner}`,
		`Authorization: ${input.scope.authorization}`,
		`Playbook: ${input.playbook.title}`,
		"",
		"## Targets",
		input.scope.targets.map((target) => `- ${target}`).join("\n"),
		"",
		"## Guardrails",
		input.scope.forbiddenActivities.map((activity) => `- ${activity}`).join("\n"),
		"",
		"## Checks",
		input.playbook.checks
			.map(
				(check) =>
					`- ${check.title}: ${check.why} Approval: ${
						check.requiresApproval ? "required before execution" : "not required for planning"
					}`
			)
			.join("\n"),
		"",
		"## Evidence",
		"```text",
		evidence.slice(0, 8000),
		"```",
		"",
		"## Assessment Notes",
		"- Separate confirmed evidence from suspicion before assigning severity.",
		"- Retest remediation with the same approved scope and playbook.",
	].join("\n");
}
