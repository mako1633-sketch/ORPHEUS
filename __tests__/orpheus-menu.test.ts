import { describe, expect, it } from "bun:test";
import { ORPHEUS_MENU_ITEMS, getOrpheusMenuActionPrompt } from "../src/components/OrpheusMenu";

describe("ORPHEUS menu", () => {
	it("includes defensive red-team assessment actions", () => {
		const labels = ORPHEUS_MENU_ITEMS.map((item) => item.label);

		expect(labels).toContain("Red Team Scope");
		expect(labels).toContain("Red Team Playbooks");
		expect(labels).toContain("Red Team Report");
	});

	it("routes red-team menu actions through the redTeamAssessment tool contract", () => {
		const scopePrompt = getOrpheusMenuActionPrompt({
			id: "red-team-scope",
			label: "Red Team Scope",
		});
		const playbooksPrompt = getOrpheusMenuActionPrompt({
			id: "red-team-playbooks",
			label: "Red Team Playbooks",
		});

		expect(scopePrompt).toContain("redTeamAssessment");
		expect(scopePrompt).toContain("scopeTemplate");
		expect(scopePrompt).toContain("authorization");
		expect(playbooksPrompt).toContain("listPlaybooks");
		expect(playbooksPrompt).toContain("runShell approval");
	});
});
