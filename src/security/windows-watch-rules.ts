export interface WindowsWatchRule {
	id: string;
	title: string;
	severity: "low" | "medium" | "high";
	checkCommand: string;
	trigger: string;
}

export const WINDOWS_WATCH_RULES: WindowsWatchRule[] = [
	{
		id: "watch-defender-disabled",
		title: "Defender protection disabled",
		severity: "high",
		checkCommand: "Get-MpComputerStatus | Select-Object AntivirusEnabled,RealTimeProtectionEnabled",
		trigger: "AntivirusEnabled=False or RealTimeProtectionEnabled=False",
	},
	{
		id: "watch-firewall-disabled",
		title: "Firewall profile disabled",
		severity: "high",
		checkCommand: "Get-NetFirewallProfile | Select-Object Name,Enabled",
		trigger: "Any profile has Enabled=False",
	},
	{
		id: "watch-new-local-admin",
		title: "Local administrator membership changed",
		severity: "high",
		checkCommand:
			"Get-LocalGroupMember -Group Administrators | Select-Object Name,ObjectClass,PrincipalSource",
		trigger: "Membership differs from previous baseline",
	},
	{
		id: "watch-new-listening-port",
		title: "New listening TCP port",
		severity: "medium",
		checkCommand: "Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess",
		trigger: "Listening port differs from previous baseline",
	},
	{
		id: "watch-new-startup-item",
		title: "New startup item",
		severity: "medium",
		checkCommand: "Get-CimInstance Win32_StartupCommand | Select-Object Name,Command,Location,User",
		trigger: "Startup item differs from previous baseline",
	},
	{
		id: "watch-scheduled-task-created",
		title: "Scheduled task creation signal",
		severity: "medium",
		checkCommand:
			"Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-TaskScheduler/Operational'; Id=106,140; StartTime=(Get-Date).AddDays(-1)} -MaxEvents 40 | Select-Object TimeCreated,Id,Message",
		trigger: "Recent task registration or update events exist",
	},
];

export function listWindowsWatchRules(): WindowsWatchRule[] {
	return WINDOWS_WATCH_RULES;
}
