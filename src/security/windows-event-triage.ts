export interface EventTriageQuery {
	id: string;
	title: string;
	logName: string;
	eventIds: number[];
	severity: "low" | "medium" | "high";
	command: string;
}

function securityQuery(
	id: string,
	title: string,
	eventIds: number[],
	severity: EventTriageQuery["severity"]
): EventTriageQuery {
	return {
		id,
		title,
		logName: "Security",
		eventIds,
		severity,
		command: `Get-WinEvent -FilterHashtable @{LogName='Security'; Id=${eventIds.join(",")}; StartTime=(Get-Date).AddDays(-7)} -MaxEvents 80 | Select-Object TimeCreated,Id,ProviderName,Message`,
	};
}

export const WINDOWS_EVENT_TRIAGE_QUERIES: EventTriageQuery[] = [
	securityQuery("failed-logons", "Failed logons", [4625], "medium"),
	securityQuery("privileged-logons", "Privileged logons", [4672, 4648], "medium"),
	securityQuery("admin-group-changes", "Administrator group changes", [4728, 4732, 4756], "high"),
	securityQuery(
		"account-created-or-enabled",
		"Account creation or enablement",
		[4720, 4722],
		"high"
	),
	{
		id: "service-installs",
		title: "New service installations",
		logName: "System",
		eventIds: [7045],
		severity: "high",
		command:
			"Get-WinEvent -FilterHashtable @{LogName='System'; Id=7045; StartTime=(Get-Date).AddDays(-7)} -MaxEvents 80 | Select-Object TimeCreated,Id,ProviderName,Message",
	},
	{
		id: "defender-detections",
		title: "Defender detections",
		logName: "Microsoft-Windows-Windows Defender/Operational",
		eventIds: [1116, 1117, 5007],
		severity: "high",
		command:
			"Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Windows Defender/Operational'; Id=1116,1117,5007; StartTime=(Get-Date).AddDays(-14)} -MaxEvents 80 | Select-Object TimeCreated,Id,ProviderName,Message",
	},
	{
		id: "powershell-script-blocks",
		title: "PowerShell script block events",
		logName: "Microsoft-Windows-PowerShell/Operational",
		eventIds: [4104],
		severity: "medium",
		command:
			"Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-PowerShell/Operational'; Id=4104; StartTime=(Get-Date).AddDays(-3)} -MaxEvents 80 | Select-Object TimeCreated,Id,ProviderName,Message",
	},
];

export function listWindowsEventTriageQueries(): EventTriageQuery[] {
	return WINDOWS_EVENT_TRIAGE_QUERIES;
}
