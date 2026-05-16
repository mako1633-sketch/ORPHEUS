import type { KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useCallback, useState } from "react";
import { COLORS } from "../ui/constants";

export interface OrpheusMenuItem {
	id: string;
	label: string;
	description?: string;
}

export const ORPHEUS_MENU_ITEMS: OrpheusMenuItem[] = [
	{
		id: "startup",
		label: "Startup Protocol",
		description: "Run full health + git + security checks",
	},
	{ id: "security", label: "Security Scan", description: "Run security audit" },
	{
		id: "red-team-scope",
		label: "Red Team Scope",
		description: "Create an authorized assessment scope",
	},
	{
		id: "red-team-playbooks",
		label: "Red Team Playbooks",
		description: "List defensive assessment playbooks",
	},
	{
		id: "red-team-report",
		label: "Red Team Report",
		description: "Format scoped evidence and retest notes",
	},
	{ id: "project", label: "Project Info", description: "Show project registry info" },
	{ id: "task", label: "Task List", description: "List active tasks" },
	{ id: "suggest", label: "Suggest Next", description: "Proactive next-action suggestions" },
	{ id: "diff", label: "Diff Review", description: "Review staged/unstaged changes" },
	{ id: "ci", label: "Pre-Push CI Gate", description: "Run local CI checks before pushing" },
	{
		id: "github-triage",
		label: "GitHub Triage",
		description: "Self-triage CI failures via GitHub API",
	},
	{ id: "shell", label: "Shell Optimizer", description: "Optimize shell aliases and patterns" },
	{ id: "status", label: "Status Dashboard", description: "Full ORPHEUS status overview" },
	{
		id: "briefing",
		label: "Launch Briefing",
		description: "Health, active work, memory, and risks",
	},
	{
		id: "context-budget",
		label: "Context Budget",
		description: "Check compaction risk before long work",
	},
	{
		id: "project-doctor",
		label: "Project Doctor",
		description: "One-command repo readiness check",
	},
	{
		id: "github-publish",
		label: "GitHub Publish",
		description: "Plan safe repo publish with secret checks",
	},
	{
		id: "memory-control",
		label: "Memory Control",
		description: "View local persistent context controls",
	},
	{ id: "scan", label: "Scan Capabilities", description: "Discover installed tools" },
	{ id: "scan-files", label: "File Guardian", description: "Scan for file anomalies" },
	{ id: "remediate", label: "Auto Remediate", description: "Run auto-remediation pipeline" },
	{
		id: "diagnostics",
		label: "Run Diagnostics",
		description: "Probe keyboard, Ollama, and app state",
	},
];

export function getOrpheusMenuActionPrompt(item: OrpheusMenuItem): string {
	const prompts: Record<string, string> = {
		startup:
			"Run the ORPHEUS startup protocol: check local health, git state, configuration, provider route, and summarize any issues with fixes.",
		security:
			"Run an ORPHEUS security scan for this local project and summarize actionable findings.",
		"red-team-scope":
			"Start an authorized defensive red-team assessment scope. Use the redTeamAssessment tool with action scopeTemplate first, then ask for any missing owner, authorization, target, date, allowed-activity, and forbidden-activity details before suggesting active validation.",
		"red-team-playbooks":
			"Show ORPHEUS defensive red-team assessment capabilities. Use the redTeamAssessment tool with action listPlaybooks, explain which scopes each playbook supports, and emphasize that any command execution still requires validated authorization and runShell approval.",
		"red-team-report":
			"Prepare a defensive red-team report workflow. Use the redTeamAssessment tool to validate scope and describe how evidence, findings, remediation, and retest notes should be formatted. Do not write a report file unless I explicitly approve it.",
		project:
			"Inspect the current ORPHEUS project setup and explain what is wired correctly or incorrectly.",
		task: "List active ORPHEUS tasks and identify any stale or incomplete work.",
		suggest:
			"Suggest the next best ORPHEUS maintenance or coding action based on the current repo state.",
		diff: "Review the current ORPHEUS git diff and call out risks, incomplete wiring, and missing tests.",
		ci: "Run local ORPHEUS CI checks (pre-push gate): typecheck, lint, format-check, and tests. Summarize failures and suggest fixes.",
		"github-triage":
			"Run ORPHEUS GitHub triage: check recent workflow failures, open issues, and PRs. Summarize actionable items.",
		shell: "Review ORPHEUS shell and CLI startup behavior for macOS compatibility issues.",
		status:
			"Show an ORPHEUS status dashboard with app health, tools, model provider, memory, and repo state.",
		briefing:
			"Show the ORPHEUS launch briefing: health, active coding task, executive items, memory state, and next suggested action.",
		"context-budget":
			"Check ORPHEUS context budget risk and tell me whether we should compact or persist task state before continuing.",
		"project-doctor":
			"Run the ORPHEUS project doctor for this repo: scripts, dependencies, git state, docs, validation, startup risks, and concrete fixes.",
		"github-publish":
			"Prepare a GitHub publish plan for this ORPHEUS repo with secret checks, README checks, commit/push approval gates, and verification steps.",
		"memory-control":
			"Open the ORPHEUS memory control center: show persistent context summary, editable actions, export option, and any stale memory risks.",
		scan: "Scan available ORPHEUS capabilities and local developer tools.",
		"scan-files":
			"Scan the ORPHEUS project files for anomalies, missing imports, stale artifacts, and incomplete wiring.",
		remediate:
			"Plan safe auto-remediation for the current ORPHEUS repo issues, asking before destructive changes.",
		diagnostics:
			"Run ORPHEUS runtime diagnostics: probe keyboard state, Ollama connectivity, app context, and system health. Report findings with fixes.",
	};

	return prompts[item.id] ?? item.description ?? item.label;
}

interface OrpheusMenuProps {
	onClose: () => void;
	onSelect?: (item: OrpheusMenuItem) => void;
}

export function OrpheusMenu({ onClose, onSelect }: OrpheusMenuProps) {
	const [selectedIndex, setSelectedIndex] = useState(0);

	const handleKeyPress = useCallback(
		(key: KeyEvent) => {
			if (key.eventType !== "press") return;

			if (key.name === "escape") {
				onClose();
				key.preventDefault();
				return;
			}

			if (key.name === "up" || key.sequence === "k") {
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : ORPHEUS_MENU_ITEMS.length - 1));
				key.preventDefault();
				return;
			}

			if (key.name === "down" || key.sequence === "j") {
				setSelectedIndex((prev) => (prev < ORPHEUS_MENU_ITEMS.length - 1 ? prev + 1 : 0));
				key.preventDefault();
				return;
			}

			if (key.name === "return") {
				const item = ORPHEUS_MENU_ITEMS[selectedIndex];
				if (item) {
					onSelect?.(item);
				}
				key.preventDefault();
				return;
			}
		},
		[selectedIndex, onClose, onSelect]
	);

	useKeyboard(handleKeyPress);

	const labelWidth = Math.max(0, ...ORPHEUS_MENU_ITEMS.map((item) => item.label.length)) + 4;

	return (
		<box
			position="absolute"
			left={0}
			top={0}
			width="100%"
			height="100%"
			flexDirection="column"
			alignItems="center"
			justifyContent="center"
			zIndex={100}
		>
			<box
				flexDirection="column"
				backgroundColor={COLORS.MENU_BG}
				borderStyle="single"
				borderColor={COLORS.MENU_BORDER}
				paddingLeft={2}
				paddingRight={2}
				paddingTop={1}
				paddingBottom={1}
				width="60%"
				minWidth={50}
				maxWidth={130}
			>
				<box marginBottom={1}>
					<text>
						<span fg={COLORS.DAEMON_LABEL}>[ ORPHEUS QUICK ACTIONS ]</span>
					</text>
				</box>
				<box marginBottom={1}>
					<text>
						<span fg={COLORS.USER_LABEL}>
							↑/↓ or j/k to navigate, ENTER to select, ESC to close
						</span>
					</text>
				</box>
				<box flexDirection="column">
					{ORPHEUS_MENU_ITEMS.map((item, idx) => {
						const isSelected = idx === selectedIndex;
						return (
							<box
								key={item.id}
								backgroundColor={isSelected ? COLORS.MENU_SELECTED_BG : COLORS.MENU_BG}
								paddingLeft={1}
								paddingRight={1}
								flexDirection="column"
							>
								<box flexDirection="row">
									<box width={labelWidth}>
										<text>
											<span fg={isSelected ? COLORS.DAEMON_LABEL : COLORS.MENU_TEXT}>
												{isSelected ? "▶ " : "  "}
												{item.label}
											</span>
										</text>
									</box>
									<box>
										<text>
											<span fg={COLORS.REASONING_DIM}>{item.description}</span>
										</text>
									</box>
								</box>
							</box>
						);
					})}
				</box>
			</box>
		</box>
	);
}
