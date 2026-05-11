export type WindowsSecurityScheduledTaskTemplateId =
	| "defenderQuickScanDaily"
	| "defenderFullScanWeekly"
	| "securityEventExportDaily";

export type WindowsSecurityScheduledTaskOperation = "create" | "update" | "enable" | "disable" | "delete";

export interface WindowsSecurityScheduledTaskTemplate {
	id: WindowsSecurityScheduledTaskTemplateId;
	name: string;
	taskPath: string;
	description: string;
	defaultTrigger: string;
	actionCommand: string;
	actionArguments: string;
	securityValue: string;
}

export interface WindowsSecurityScheduledTaskPlan {
	operation: WindowsSecurityScheduledTaskOperation;
	template: WindowsSecurityScheduledTaskTemplate;
	command: string;
	rollbackCommand: string;
	requiresApproval: true;
	notes: string[];
}

const ORPHEUS_SECURITY_TASK_PATH = "\\ORPHEUS\\Security\\";

const WINDOWS_SECURITY_SCHEDULED_TASK_TEMPLATES: Record<
	WindowsSecurityScheduledTaskTemplateId,
	WindowsSecurityScheduledTaskTemplate
> = {
	defenderQuickScanDaily: {
		id: "defenderQuickScanDaily",
		name: "ORPHEUS Defender Quick Scan",
		taskPath: ORPHEUS_SECURITY_TASK_PATH,
		description: "Run a daily Microsoft Defender quick scan.",
		defaultTrigger: "Daily at 03:00",
		actionCommand: "PowerShell.exe",
		actionArguments: '-NoProfile -WindowStyle Hidden -Command "Start-MpScan -ScanType QuickScan"',
		securityValue: "Creates repeatable endpoint malware scanning without changing Defender policy.",
	},
	defenderFullScanWeekly: {
		id: "defenderFullScanWeekly",
		name: "ORPHEUS Defender Full Scan",
		taskPath: ORPHEUS_SECURITY_TASK_PATH,
		description: "Run a weekly Microsoft Defender full scan.",
		defaultTrigger: "Weekly on Sunday at 02:00",
		actionCommand: "PowerShell.exe",
		actionArguments: '-NoProfile -WindowStyle Hidden -Command "Start-MpScan -ScanType FullScan"',
		securityValue: "Adds a deeper periodic malware scan for workstations that can tolerate longer scans.",
	},
	securityEventExportDaily: {
		id: "securityEventExportDaily",
		name: "ORPHEUS Security Event Export",
		taskPath: ORPHEUS_SECURITY_TASK_PATH,
		description: "Export recent warning/error Security log events daily for review.",
		defaultTrigger: "Daily at 04:00",
		actionCommand: "PowerShell.exe",
		actionArguments:
			"-NoProfile -WindowStyle Hidden -Command \"$dir=Join-Path $env:ProgramData 'ORPHEUS\\SecurityLogs'; New-Item -ItemType Directory -Force -Path $dir | Out-Null; Get-WinEvent -FilterHashtable @{LogName='Security'; StartTime=(Get-Date).AddDays(-1)} -MaxEvents 500 | Export-Clixml -Path (Join-Path $dir ('security-events-' + (Get-Date -Format yyyyMMdd-HHmmss) + '.xml'))\"",
		securityValue: "Keeps a local review trail of recent Security log events without sending data anywhere.",
	},
};

function quotePowerShellString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

function buildTriggerExpression(templateId: WindowsSecurityScheduledTaskTemplateId): string {
	if (templateId === "defenderFullScanWeekly") {
		return "New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 2:00am";
	}
	if (templateId === "securityEventExportDaily") {
		return "New-ScheduledTaskTrigger -Daily -At 4:00am";
	}
	return "New-ScheduledTaskTrigger -Daily -At 3:00am";
}

function buildTaskVariableSetup(template: WindowsSecurityScheduledTaskTemplate): string[] {
	return [
		`$taskName=${quotePowerShellString(template.name)}`,
		`$taskPath=${quotePowerShellString(template.taskPath)}`,
		`$action=New-ScheduledTaskAction -Execute ${quotePowerShellString(template.actionCommand)} -Argument ${quotePowerShellString(template.actionArguments)}`,
		`$trigger=${buildTriggerExpression(template.id)}`,
		"$principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest",
		"$settings=New-ScheduledTaskSettingsSet -Compatibility Win8 -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 4)",
	];
}

function buildCreateOrUpdateCommand(template: WindowsSecurityScheduledTaskTemplate): string {
	return [
		...buildTaskVariableSetup(template),
		"$existing=Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction SilentlyContinue",
		'if ($existing) { Set-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null; Enable-ScheduledTask -TaskPath $taskPath -TaskName $taskName | Out-Null; Write-Output "Updated scheduled security task: $taskPath$taskName" } else { Register-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description ' +
			quotePowerShellString(template.description) +
			' | Out-Null; Write-Output "Created scheduled security task: $taskPath$taskName" }',
	].join("; ");
}

function buildTaskStateCommand(
	template: WindowsSecurityScheduledTaskTemplate,
	operation: "enable" | "disable" | "delete"
): string {
	const verb =
		operation === "enable"
			? "Enable-ScheduledTask"
			: operation === "disable"
				? "Disable-ScheduledTask"
				: "Unregister-ScheduledTask -Confirm:$false";
	const past = operation === "enable" ? "Enabled" : operation === "disable" ? "Disabled" : "Deleted";
	return [
		`$taskName=${quotePowerShellString(template.name)}`,
		`$taskPath=${quotePowerShellString(template.taskPath)}`,
		"$existing=Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction SilentlyContinue",
		`if (-not $existing) { throw "Scheduled task not found: $taskPath$taskName" }`,
		`${verb} -TaskPath $taskPath -TaskName $taskName | Out-Null`,
		`Write-Output "${past} scheduled security task: $taskPath$taskName"`,
	].join("; ");
}

export function listWindowsSecurityScheduledTaskTemplates(): WindowsSecurityScheduledTaskTemplate[] {
	return Object.values(WINDOWS_SECURITY_SCHEDULED_TASK_TEMPLATES);
}

export function getWindowsSecurityScheduledTaskTemplate(
	templateId: WindowsSecurityScheduledTaskTemplateId
): WindowsSecurityScheduledTaskTemplate {
	return WINDOWS_SECURITY_SCHEDULED_TASK_TEMPLATES[templateId];
}

export function buildWindowsSecurityScheduledTaskInventoryCommand(): string {
	return [
		"Get-ScheduledTask -TaskPath '\\ORPHEUS\\Security\\' -ErrorAction SilentlyContinue",
		"Select-Object TaskPath,TaskName,State,@{Name='NextRunTime';Expression={(Get-ScheduledTaskInfo -TaskPath $_.TaskPath -TaskName $_.TaskName -ErrorAction SilentlyContinue).NextRunTime}},Description",
		"Format-Table -AutoSize",
	].join(" | ");
}

export function buildWindowsSecurityScheduledTaskPlan(
	operation: WindowsSecurityScheduledTaskOperation,
	templateId: WindowsSecurityScheduledTaskTemplateId
): WindowsSecurityScheduledTaskPlan {
	const template = getWindowsSecurityScheduledTaskTemplate(templateId);
	const command =
		operation === "create" || operation === "update"
			? buildCreateOrUpdateCommand(template)
			: buildTaskStateCommand(template, operation);
	const rollbackCommand =
		operation === "delete"
			? buildCreateOrUpdateCommand(template)
			: operation === "disable"
				? buildTaskStateCommand(template, "enable")
				: buildTaskStateCommand(template, "disable");

	return {
		operation,
		template,
		command,
		rollbackCommand,
		requiresApproval: true,
		notes: [
			"Only ORPHEUS-owned security tasks under \\ORPHEUS\\Security\\ are created or modified.",
			"Commands run as SYSTEM because Defender scans and Security log export can require elevated local rights.",
			"Review the generated command before approving execution.",
		],
	};
}
