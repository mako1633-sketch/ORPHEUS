export type WindowsSecurityPlaybookId =
	| "quickPosture"
	| "defenderFirewall"
	| "patchPosture"
	| "startupPersistence"
	| "networkReview"
	| "suspiciousProcessTriage"
	| "securitySignalsReview"
	| "fullReadOnlyAssessment";

export type WindowsSecurityCheck = {
	id: string;
	title: string;
	why: string;
	command: string;
};

type WindowsSecurityCheckId =
	| "computerInfo"
	| "hotfixes"
	| "defender"
	| "firewallProfiles"
	| "localUsers"
	| "admins"
	| "startupItems"
	| "services"
	| "scheduledTasks"
	| "listeningPorts"
	| "processOverview"
	| "recentSecurityEvents";

export type WindowsSecurityPlaybook = {
	id: WindowsSecurityPlaybookId;
	title: string;
	description: string;
	riskLevel: "read-only";
	checks: WindowsSecurityCheck[];
};

const CHECKS: Record<WindowsSecurityCheckId, WindowsSecurityCheck> = {
	computerInfo: {
		id: "computerInfo",
		title: "Windows build and device summary",
		why: "Establishes OS build, install age, secure boot visibility, domain/workgroup context, and hardware basics.",
		command:
			"Get-ComputerInfo | Select-Object WindowsProductName,WindowsVersion,OsHardwareAbstractionLayer,OsArchitecture,OsBuildNumber,OsInstallDate,CsName,CsDomain,CsPartOfDomain,BiosFirmwareType,BiosSeralNumber",
	},
	hotfixes: {
		id: "hotfixes",
		title: "Recent installed updates",
		why: "Shows whether the machine has recent Windows servicing activity and helps identify patch drift.",
		command:
			"Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 20 HotFixID,Description,InstalledOn,InstalledBy",
	},
	defender: {
		id: "defender",
		title: "Microsoft Defender status",
		why: "Confirms antivirus engine, real-time protection, signatures, and tamper-related posture where available.",
		command:
			"Get-MpComputerStatus | Select-Object AMServiceEnabled,AntivirusEnabled,RealTimeProtectionEnabled,BehaviorMonitorEnabled,IoavProtectionEnabled,AntispywareEnabled,NISEnabled,IsTamperProtected,AntivirusSignatureLastUpdated,AntivirusSignatureVersion,QuickScanEndTime,FullScanEndTime",
	},
	firewallProfiles: {
		id: "firewallProfiles",
		title: "Firewall profile state",
		why: "Checks whether Domain, Private, and Public profiles are enabled and what inbound posture they enforce.",
		command:
			"Get-NetFirewallProfile | Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction,NotifyOnListen,LogAllowed,LogBlocked,LogFileName",
	},
	localUsers: {
		id: "localUsers",
		title: "Local user account posture",
		why: "Highlights enabled local accounts, stale accounts, and accounts with password-expiration exceptions.",
		command:
			"Get-LocalUser | Select-Object Name,Enabled,LastLogon,PasswordRequired,PasswordExpires,UserMayChangePassword",
	},
	admins: {
		id: "admins",
		title: "Local administrators",
		why: "Identifies who has local administrative control without reading credentials or secrets.",
		command: "Get-LocalGroupMember -Group Administrators | Select-Object Name,ObjectClass,PrincipalSource",
	},
	startupItems: {
		id: "startupItems",
		title: "Startup commands",
		why: "Finds common autorun entries that can affect boot performance or indicate persistence.",
		command:
			"Get-CimInstance Win32_StartupCommand | Select-Object Name,Command,Location,User | Sort-Object Location,Name",
	},
	services: {
		id: "services",
		title: "Automatic non-Microsoft services",
		why: "Surfaces third-party services that start automatically and may need review.",
		command:
			"Get-CimInstance Win32_Service | Where-Object { $_.StartMode -eq 'Auto' -and $_.PathName -notmatch 'Windows\\\\System32' } | Select-Object Name,DisplayName,State,StartMode,StartName,PathName | Sort-Object Name",
	},
	scheduledTasks: {
		id: "scheduledTasks",
		title: "Enabled scheduled tasks",
		why: "Reviews enabled non-trivial scheduled tasks without changing task configuration.",
		command:
			"Get-ScheduledTask | Where-Object { $_.State -ne 'Disabled' } | Select-Object TaskPath,TaskName,State,Author | Sort-Object TaskPath,TaskName | Select-Object -First 80",
	},
	listeningPorts: {
		id: "listeningPorts",
		title: "Listening TCP ports",
		why: "Shows exposed local services and owning process IDs for follow-up review.",
		command:
			"Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess | Sort-Object LocalPort",
	},
	processOverview: {
		id: "processOverview",
		title: "Top running processes",
		why: "Provides a lightweight process view for suspicious-process triage without dumping memory or secrets.",
		command:
			"Get-Process | Sort-Object CPU -Descending | Select-Object -First 30 ProcessName,Id,CPU,WorkingSet,Path",
	},
	recentSecurityEvents: {
		id: "recentSecurityEvents",
		title: "Recent security event signals",
		why: "Samples recent logon, account, and audit-policy events without clearing or modifying logs.",
		command:
			"Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4624,4625,4634,4648,4672,4720,4722,4726,4732,4738; StartTime=(Get-Date).AddDays(-7)} -MaxEvents 60 | Select-Object TimeCreated,Id,ProviderName,Message",
	},
};

const PLAYBOOKS: Record<WindowsSecurityPlaybookId, WindowsSecurityPlaybook> = {
	quickPosture: {
		id: "quickPosture",
		title: "Quick Windows posture check",
		description:
			"Fast read-only baseline for update, Defender, firewall, admin, startup, and listening-port posture.",
		riskLevel: "read-only",
		checks: [
			CHECKS.computerInfo,
			CHECKS.hotfixes,
			CHECKS.defender,
			CHECKS.firewallProfiles,
			CHECKS.admins,
			CHECKS.startupItems,
			CHECKS.listeningPorts,
		],
	},
	defenderFirewall: {
		id: "defenderFirewall",
		title: "Defender and firewall audit",
		description: "Focused read-only review of Microsoft Defender and Windows Firewall state.",
		riskLevel: "read-only",
		checks: [CHECKS.defender, CHECKS.firewallProfiles],
	},
	patchPosture: {
		id: "patchPosture",
		title: "Patch posture review",
		description: "Read-only OS version and recent hotfix review.",
		riskLevel: "read-only",
		checks: [CHECKS.computerInfo, CHECKS.hotfixes],
	},
	startupPersistence: {
		id: "startupPersistence",
		title: "Startup and persistence review",
		description: "Read-only review of startup entries, automatic services, and enabled scheduled tasks.",
		riskLevel: "read-only",
		checks: [CHECKS.startupItems, CHECKS.services, CHECKS.scheduledTasks],
	},
	networkReview: {
		id: "networkReview",
		title: "Network listening review",
		description: "Read-only local listening-port and firewall posture review.",
		riskLevel: "read-only",
		checks: [CHECKS.firewallProfiles, CHECKS.listeningPorts],
	},
	suspiciousProcessTriage: {
		id: "suspiciousProcessTriage",
		title: "Suspicious process triage",
		description: "Read-only process, service, startup, and security-event signals for triage.",
		riskLevel: "read-only",
		checks: [CHECKS.processOverview, CHECKS.services, CHECKS.startupItems, CHECKS.recentSecurityEvents],
	},
	securitySignalsReview: {
		id: "securitySignalsReview",
		title: "Defender, firewall, persistence, ports, and logs review",
		description:
			"Focused read-only review of Defender, firewall profiles, startup items, automatic services, listening ports, and recent security-event signals.",
		riskLevel: "read-only",
		checks: [
			CHECKS.defender,
			CHECKS.firewallProfiles,
			CHECKS.startupItems,
			CHECKS.services,
			CHECKS.listeningPorts,
			CHECKS.recentSecurityEvents,
		],
	},
	fullReadOnlyAssessment: {
		id: "fullReadOnlyAssessment",
		title: "Full read-only Windows assessment",
		description: "Comprehensive built-in evidence collection for local Windows security posture.",
		riskLevel: "read-only",
		checks: [
			CHECKS.computerInfo,
			CHECKS.hotfixes,
			CHECKS.defender,
			CHECKS.firewallProfiles,
			CHECKS.localUsers,
			CHECKS.admins,
			CHECKS.startupItems,
			CHECKS.services,
			CHECKS.scheduledTasks,
			CHECKS.listeningPorts,
			CHECKS.processOverview,
			CHECKS.recentSecurityEvents,
		],
	},
};

export function getWindowsSecurityPlaybook(id: WindowsSecurityPlaybookId): WindowsSecurityPlaybook {
	return PLAYBOOKS[id];
}

export function listWindowsSecurityPlaybooks(): WindowsSecurityPlaybook[] {
	return Object.values(PLAYBOOKS);
}

export function buildWindowsSecurityPlaybookCommand(id: WindowsSecurityPlaybookId): string {
	const playbook = getWindowsSecurityPlaybook(id);
	return playbook.checks
		.map((check) => {
			const title = check.title.replace(/'/g, "''");
			return `Write-Output ''; Write-Output '### ${title}'; ${check.command}`;
		})
		.join("; ");
}
