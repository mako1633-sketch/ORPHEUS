export type WindowsHardeningProfileId =
	| "homeWorkstation"
	| "developerWorkstation"
	| "highSecurityLaptop"
	| "smallBusinessEndpoint"
	| "serverLite";

export type HardeningCategory =
	| "defender"
	| "firewall"
	| "accounts"
	| "updates"
	| "powershell"
	| "remoteAccess"
	| "logging"
	| "persistence";

export type HardeningStage =
	| "quick-win"
	| "needs-admin"
	| "needs-reboot"
	| "usability-tradeoff"
	| "managed-policy";

export interface WindowsHardeningRule {
	id: string;
	title: string;
	category: HardeningCategory;
	severity: "low" | "medium" | "high";
	baselineRefs: string[];
	rationale: string;
	checkCommand: string;
	expectedState: string;
	remediationCommand: string;
	rollbackCommand: string;
	policyCheckCommand: string;
	stages: HardeningStage[];
}

export interface WindowsHardeningProfile {
	id: WindowsHardeningProfileId;
	title: string;
	description: string;
	ruleIds: string[];
}

export const WINDOWS_HARDENING_RULES: Record<string, WindowsHardeningRule> = {
	"defender-realtime-on": {
		id: "defender-realtime-on",
		title: "Microsoft Defender real-time protection enabled",
		category: "defender",
		severity: "high",
		baselineRefs: ["Microsoft Security Baseline: Defender Antivirus", "CIS Windows: Malware defenses"],
		rationale: "Real-time protection catches malicious files and scripts before execution.",
		checkCommand: "Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled,AntivirusEnabled",
		expectedState: "RealTimeProtectionEnabled=True and AntivirusEnabled=True",
		remediationCommand: "Set-MpPreference -DisableRealtimeMonitoring $false",
		rollbackCommand: "Set-MpPreference -DisableRealtimeMonitoring $true",
		policyCheckCommand:
			"Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Real-Time Protection' -ErrorAction SilentlyContinue",
		stages: ["quick-win", "needs-admin"],
	},
	"defender-cloud-on": {
		id: "defender-cloud-on",
		title: "Defender cloud-delivered protection enabled",
		category: "defender",
		severity: "medium",
		baselineRefs: ["Microsoft Security Baseline: Cloud protection"],
		rationale: "Cloud protection improves detection speed for emerging threats.",
		checkCommand: "Get-MpPreference | Select-Object MAPSReporting,SubmitSamplesConsent",
		expectedState: "MAPSReporting is enabled; sample submission follows user policy.",
		remediationCommand: "Set-MpPreference -MAPSReporting Advanced",
		rollbackCommand: "Set-MpPreference -MAPSReporting Disabled",
		policyCheckCommand:
			"Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Spynet' -ErrorAction SilentlyContinue",
		stages: ["quick-win", "needs-admin", "usability-tradeoff"],
	},
	"firewall-enabled": {
		id: "firewall-enabled",
		title: "Windows Firewall enabled on all profiles",
		category: "firewall",
		severity: "high",
		baselineRefs: ["Microsoft Security Baseline: Firewall", "CIS Windows: Firewall profile state"],
		rationale: "Firewall profiles reduce exposure of local services on untrusted networks.",
		checkCommand: "Get-NetFirewallProfile | Select-Object Name,Enabled,DefaultInboundAction",
		expectedState: "Enabled=True for Domain, Private, and Public profiles.",
		remediationCommand: "Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True",
		rollbackCommand: "Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled False",
		policyCheckCommand:
			"Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\WindowsFirewall\\DomainProfile','HKLM:\\SOFTWARE\\Policies\\Microsoft\\WindowsFirewall\\PrivateProfile','HKLM:\\SOFTWARE\\Policies\\Microsoft\\WindowsFirewall\\PublicProfile' -ErrorAction SilentlyContinue",
		stages: ["quick-win", "needs-admin"],
	},
	"firewall-block-inbound": {
		id: "firewall-block-inbound",
		title: "Default inbound firewall action blocks unsolicited traffic",
		category: "firewall",
		severity: "medium",
		baselineRefs: ["CIS Windows: Default inbound action"],
		rationale: "Block-by-default inbound policy prevents accidental exposure of services.",
		checkCommand: "Get-NetFirewallProfile | Select-Object Name,DefaultInboundAction",
		expectedState: "DefaultInboundAction=Block for all active profiles.",
		remediationCommand: "Set-NetFirewallProfile -Profile Domain,Private,Public -DefaultInboundAction Block",
		rollbackCommand: "Set-NetFirewallProfile -Profile Domain,Private,Public -DefaultInboundAction Allow",
		policyCheckCommand:
			"Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\WindowsFirewall' -ErrorAction SilentlyContinue",
		stages: ["quick-win", "needs-admin", "usability-tradeoff"],
	},
	"local-admin-review": {
		id: "local-admin-review",
		title: "Local administrators reviewed",
		category: "accounts",
		severity: "medium",
		baselineRefs: ["CIS Windows: Local group membership"],
		rationale: "Excess local administrators increase the impact of account compromise.",
		checkCommand:
			"Get-LocalGroupMember -Group Administrators | Select-Object Name,ObjectClass,PrincipalSource",
		expectedState: "Only expected named administrators and managed groups are present.",
		remediationCommand: "Remove-LocalGroupMember -Group Administrators -Member '<member-to-remove>'",
		rollbackCommand: "Add-LocalGroupMember -Group Administrators -Member '<member-to-restore>'",
		policyCheckCommand:
			"Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Group Policy' -ErrorAction SilentlyContinue",
		stages: ["needs-admin", "usability-tradeoff"],
	},
	"updates-automatic": {
		id: "updates-automatic",
		title: "Windows Update automatic update policy reviewed",
		category: "updates",
		severity: "medium",
		baselineRefs: ["Microsoft Security Baseline: Windows Update"],
		rationale: "Reliable update policy reduces exposure to known vulnerabilities.",
		checkCommand:
			"Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU' -ErrorAction SilentlyContinue",
		expectedState: "Automatic update policy is configured intentionally or local defaults are acceptable.",
		remediationCommand:
			"Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU' -Name NoAutoUpdate -Value 0",
		rollbackCommand:
			"Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU' -Name NoAutoUpdate",
		policyCheckCommand:
			"Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate' -ErrorAction SilentlyContinue",
		stages: ["needs-admin", "managed-policy"],
	},
	"powershell-logging": {
		id: "powershell-logging",
		title: "PowerShell operational logging reviewed",
		category: "powershell",
		severity: "medium",
		baselineRefs: ["Microsoft Security Baseline: PowerShell logging"],
		rationale: "PowerShell logs help investigate malicious or accidental script activity.",
		checkCommand:
			"Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging','HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ModuleLogging' -ErrorAction SilentlyContinue",
		expectedState: "Script block and module logging are enabled where appropriate.",
		remediationCommand:
			"New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging' -Force; Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging' -Name EnableScriptBlockLogging -Value 1",
		rollbackCommand:
			"Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging' -Name EnableScriptBlockLogging",
		policyCheckCommand:
			"Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell' -ErrorAction SilentlyContinue",
		stages: ["needs-admin", "managed-policy"],
	},
	"rdp-disabled-or-restricted": {
		id: "rdp-disabled-or-restricted",
		title: "Remote Desktop disabled or intentionally restricted",
		category: "remoteAccess",
		severity: "high",
		baselineRefs: ["CIS Windows: Remote access minimization"],
		rationale: "Exposed remote access increases brute-force and lateral movement risk.",
		checkCommand:
			"Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' | Select-Object fDenyTSConnections",
		expectedState: "RDP disabled unless explicitly required and firewall-restricted.",
		remediationCommand:
			"Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -Value 1",
		rollbackCommand:
			"Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -Value 0",
		policyCheckCommand:
			"Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services' -ErrorAction SilentlyContinue",
		stages: ["needs-admin", "usability-tradeoff"],
	},
};

export const WINDOWS_HARDENING_PROFILES: Record<WindowsHardeningProfileId, WindowsHardeningProfile> = {
	homeWorkstation: {
		id: "homeWorkstation",
		title: "Home workstation",
		description: "Balanced protection for a personal Windows device with low maintenance burden.",
		ruleIds: [
			"defender-realtime-on",
			"defender-cloud-on",
			"firewall-enabled",
			"firewall-block-inbound",
			"updates-automatic",
		],
	},
	developerWorkstation: {
		id: "developerWorkstation",
		title: "Developer workstation",
		description: "Protects a dev machine while acknowledging local servers, tooling, and test workflows.",
		ruleIds: [
			"defender-realtime-on",
			"defender-cloud-on",
			"firewall-enabled",
			"local-admin-review",
			"powershell-logging",
			"updates-automatic",
		],
	},
	highSecurityLaptop: {
		id: "highSecurityLaptop",
		title: "High-security laptop",
		description: "Stricter baseline for mobile or sensitive-data Windows devices.",
		ruleIds: Object.keys(WINDOWS_HARDENING_RULES),
	},
	smallBusinessEndpoint: {
		id: "smallBusinessEndpoint",
		title: "Small business endpoint",
		description: "Endpoint baseline suitable for unmanaged or lightly managed business PCs.",
		ruleIds: [
			"defender-realtime-on",
			"defender-cloud-on",
			"firewall-enabled",
			"firewall-block-inbound",
			"local-admin-review",
			"updates-automatic",
			"powershell-logging",
		],
	},
	serverLite: {
		id: "serverLite",
		title: "Server-lite",
		description: "Conservative baseline for a Windows box that intentionally hosts local services.",
		ruleIds: [
			"defender-realtime-on",
			"firewall-enabled",
			"local-admin-review",
			"updates-automatic",
			"powershell-logging",
			"rdp-disabled-or-restricted",
		],
	},
};

export function listWindowsHardeningProfiles(): WindowsHardeningProfile[] {
	return Object.values(WINDOWS_HARDENING_PROFILES);
}

export function getWindowsHardeningProfile(id: WindowsHardeningProfileId): WindowsHardeningProfile {
	return WINDOWS_HARDENING_PROFILES[id];
}

export function getWindowsHardeningRulesForProfile(id: WindowsHardeningProfileId): WindowsHardeningRule[] {
	return getWindowsHardeningProfile(id).ruleIds.flatMap((ruleId) => {
		const rule = WINDOWS_HARDENING_RULES[ruleId];
		return rule ? [rule] : [];
	});
}
