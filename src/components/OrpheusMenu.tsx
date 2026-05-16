import type { KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useCallback, useState } from "react";
import { COLORS } from "../ui/constants";

export interface OrpheusMenuItem {
	id: string;
	label: string;
	description?: string;
}

const DEFAULT_ITEMS: OrpheusMenuItem[] = [
	{
		id: "startup",
		label: "Startup Protocol",
		description: "Run full health + git + security checks",
	},
	{ id: "security", label: "Security Scan", description: "Run security audit" },
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
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : DEFAULT_ITEMS.length - 1));
				key.preventDefault();
				return;
			}

			if (key.name === "down" || key.sequence === "j") {
				setSelectedIndex((prev) => (prev < DEFAULT_ITEMS.length - 1 ? prev + 1 : 0));
				key.preventDefault();
				return;
			}

			if (key.name === "return") {
				const item = DEFAULT_ITEMS[selectedIndex];
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

	const labelWidth = Math.max(0, ...DEFAULT_ITEMS.map((item) => item.label.length)) + 4;

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
					{DEFAULT_ITEMS.map((item, idx) => {
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
