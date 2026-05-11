export interface StartupAction {
	label: string;
	description?: string;
	prompt: string;
}

const WINDOWS_STARTUP_ACTIONS: StartupAction[] = [
	{
		label: "Evidence Pack: client-ready assessment bundle",
		description:
			"Run a billable client evidence pack with snapshot, delta, remediation tracker, and manifest.",
		prompt:
			"Create a Managed Security Evidence Pack for Client. Run the full read-only assessment, parse findings, save client-scoped history, compare against the previous run, and export the client-ready evidence pack.",
	},
	{
		label: "Blackwall Snapshot: score, findings, fix plan",
		description: "Neon read-only endpoint audit with cyber-readiness questions and follow-up prompts.",
		prompt:
			"Run an ORPHEUS Security Snapshot on this Windows device. Use the full read-only assessment, parse the result, score the posture, and produce an executive summary with prioritized fixes, cyber-readiness controls, owner questions, and suggested follow-up prompts.",
	},
	{
		label: "ORPHEUS Doctor: keys, tools, PowerShell, Signal, search",
		description: "Probe keys, tool relays, shell access, Signal, and search uplink health.",
		prompt: "Run ORPHEUS doctor and tell me what needs attention.",
	},
	{
		label: "Quick Scan: posture pulse",
		description: "Fast local pulse for updates, Defender, firewall, admins, startup, and ports.",
		prompt: "Run a quick read-only Windows security posture assessment on this device.",
	},
	{
		label: "Full Audit: evidence dive",
		description: "Deep local evidence collection with findings and remediation plan.",
		prompt:
			"Run a full read-only Windows security assessment on this device and structure the findings. Retrieve the fullReadOnlyAssessment playbook first, ask approval to run the read-only command bundle, then parse the real command output.",
	},
	{
		label: "Signal Sweep: Defender, firewall, services, ports, logs",
		description: "Focused triage of endpoint security signals and suspicious drift.",
		prompt:
			"Review Defender, firewall, startup items, services, listening ports, and recent security event signals.",
	},
	{
		label: "Crash Forensics: setup errors and app faults",
		description: "Inspect errors, logs, dependencies, and local project state.",
		prompt: "Help me debug the current ORPHEUS setup error or app crash.",
	},
	{
		label: "Codejack: inspect and edit project files",
		description: "Use ORPHEUS as a coding agent inside the current workspace.",
		prompt: "Inspect this project and help me make the requested code change.",
	},
	{
		label: "PowerShell Probe: approved read-only commands",
		description: "Inspect the machine with approval-gated shell probes.",
		prompt: "Run approved read-only PowerShell inspection commands for the task I describe.",
	},
	{
		label: "Netwatch: search current sources",
		description: "Gather current sources and cite the evidence used.",
		prompt: "Search the web for current sources on the topic I provide and cite what you use.",
	},
];

const MAC_STARTUP_ACTIONS: StartupAction[] = [
	{
		label: "Mac Checkup: keys, tools, shell, Signal, search",
		description: "Probe keys, tool relays, shell access, Signal, browser rendering, and search health.",
		prompt: "Run ORPHEUS doctor and tell me what needs attention on this Mac.",
	},
	{
		label: "Workspace Scan: project and setup health",
		description: "Inspect the current workspace, dependencies, scripts, and likely setup blockers.",
		prompt:
			"Inspect this project on macOS. Check package scripts, dependencies, local tool availability, and setup issues. Recommend concrete fixes before editing files.",
	},
	{
		label: "Shell Probe: approved read-only commands",
		description: "Inspect the machine with approval-gated bash or zsh probes.",
		prompt: "Run approved read-only macOS shell inspection commands for the task I describe.",
	},
	{
		label: "Crash Forensics: setup errors and app faults",
		description: "Inspect errors, logs, dependencies, and local project state.",
		prompt: "Help me debug the current ORPHEUS setup error or app crash on macOS.",
	},
	{
		label: "Codejack: inspect and edit project files",
		description: "Use ORPHEUS as a coding agent inside the current workspace.",
		prompt: "Inspect this project and help me make the requested code change.",
	},
	{
		label: "Netwatch: search current sources",
		description: "Gather current sources and cite the evidence used.",
		prompt: "Search the web for current sources on the topic I provide and cite what you use.",
	},
];

export function getStartupActions(platform = process.platform): StartupAction[] {
	return platform === "win32" ? [...WINDOWS_STARTUP_ACTIONS] : [...MAC_STARTUP_ACTIONS];
}

export const STARTUP_COMMON_ACTIONS: StartupAction[] = getStartupActions();

export function getStartupActionForKey(sequence: string | undefined): StartupAction | null {
	if (!sequence || !/^[1-9]$/.test(sequence)) return null;
	const index = Number(sequence) - 1;
	return STARTUP_COMMON_ACTIONS[index] ?? null;
}

export function getStartupActionForInput(
	input: string | undefined,
	options: { allowBareNumber?: boolean } = {}
): StartupAction | null {
	const normalized =
		input
			?.trim()
			.replace(/\s+/g, " ")
			.replace(/[.!?]+$/g, "") ?? "";
	if (!normalized) return null;

	const match = /^(?:run|start|execute|select|choose|option)\s+(?:option\s+)?([1-9])$/i.exec(normalized);
	const sequence =
		match?.[1] ?? (options.allowBareNumber && /^[1-9]$/.test(normalized) ? normalized : undefined);
	return getStartupActionForKey(sequence);
}
