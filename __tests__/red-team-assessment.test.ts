import { describe, expect, it } from "bun:test";
import { redTeamAssessment } from "../src/ai/tools/red-team-assessment";
import {
	buildRedTeamPlaybookCommand,
	getRedTeamPlaybook,
	recommendRedTeamPlaybooks,
} from "../src/security/red-team-playbooks";
import { buildRedTeamScope } from "../src/security/red-team-scope";

function toolExecute<TInput, TOutput>(input: TInput): Promise<TOutput> {
	return (
		redTeamAssessment as unknown as {
			execute: (input: TInput) => Promise<TOutput>;
		}
	).execute(input);
}

describe("red team assessment", () => {
	it("requires authorization before a scope is ready", () => {
		const scope = buildRedTeamScope({
			name: "Internal review",
			kind: "network",
			targets: ["10.0.0.0/24"],
			owner: "Security",
		});

		expect(scope.ready).toBe(false);
		expect(scope.missing).toContain("authorization");
		expect(scope.forbiddenActivities).toContain("credential-theft");
		expect(scope.forbiddenActivities).toContain("stealth");
	});

	it("recommends playbooks that match the validated scope kind", () => {
		const scope = buildRedTeamScope({
			name: "Public site review",
			kind: "domain",
			targets: ["example.com"],
			owner: "Example Security",
			authorization: "Ticket SEC-123",
		});

		const playbooks = recommendRedTeamPlaybooks(scope).map((playbook) => playbook.id);

		expect(playbooks).toContain("externalDomainRecon");
		expect(playbooks).toContain("webAppHeadersReview");
		expect(playbooks).not.toContain("networkServiceReview");
	});

	it("returns approval-gated commands without executing them", async () => {
		const result = await toolExecute<
			unknown,
			{
				success: boolean;
				approvalRequired?: boolean;
				playbook?: { command: string; disallowed: string[] };
			}
		>({
			action: "getPlaybook",
			playbook: "externalDomainRecon",
			scope: {
				name: "Public site review",
				kind: "domain",
				targets: ["example.com"],
				owner: "Example Security",
				authorization: "Ticket SEC-123",
			},
		});

		expect(result.success).toBe(true);
		expect(result.approvalRequired).toBe(true);
		expect(result.playbook?.command).toContain("curl -fsSIL");
		expect(result.playbook?.command).toContain("TARGET_DOMAIN");
		expect(result.playbook?.disallowed).toContain("credential attacks");
	});

	it("rejects playbooks outside the validated scope kind", async () => {
		const result = await toolExecute<unknown, { success: boolean; error?: string }>({
			action: "getPlaybook",
			playbook: "networkServiceReview",
			scope: {
				name: "Public site review",
				kind: "domain",
				targets: ["example.com"],
				owner: "Example Security",
				authorization: "Ticket SEC-123",
			},
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain("not intended for domain scope");
	});

	it("builds playbook commands from low-impact checks only", () => {
		const command = buildRedTeamPlaybookCommand("networkServiceReview");
		const playbook = getRedTeamPlaybook("networkServiceReview");

		expect(playbook.riskLevel).toBe("approval-required");
		expect(command).toContain("nc -vz TARGET_HOST TARGET_PORT");
		expect(command).not.toContain("nmap");
		expect(command).not.toContain("hydra");
		expect(command).not.toContain("msfconsole");
	});
});
