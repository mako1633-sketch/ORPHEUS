import { homedir } from "node:os";

const SENSITIVE_PATHS = [
	"~/.ssh",
	"~/.gnupg",
	"~/.gpg",
	"~/.aws",
	"~/.azure",
	"~/.config/gcloud",
	"~/.kube",
	"~/Library/Application Support/Google/Chrome",
	"~/Library/Application Support/Firefox",
	"~/Library/Application Support/Microsoft Edge",
	"~/Library/Safari",
	"~/.config/google-chrome",
	"~/.config/chromium",
	"~/.mozilla/firefox",
	"~/Library/Keychains",
	"~/.password-store",
	"~/.local/share/keyrings",
	"~/.env",
	"~/.envrc",
	"~/.netrc",
	"~/Downloads",
	"~/Documents",
	"~/Desktop",
	"~/Pictures",
	"~/Videos",
	"~/Movies",
	"~/Music",
	"~/OneDrive",
	"~/AppData/Roaming/Microsoft/Credentials",
	"~/AppData/Local/Microsoft/Credentials",
	"~/AppData/Roaming/Microsoft/Windows/PowerShell/PSReadLine",
	"~/AppData/Local/Google/Chrome/User Data",
	"~/AppData/Local/Microsoft/Edge/User Data",
	"~/AppData/Roaming/Mozilla/Firefox",
	"~/Library/Messages",
	"~/Library/Mail",
	"~/Library/Calendars",
	"~/Library/Contacts",
	"~/Library/Cookies",
	"~/.docker/config.json",
	"~/.npmrc",
	"~/.pypirc",
	"~/.gem/credentials",
	"~/.config/gh",
	"~/.config/hub",
	"~/.bash_history",
	"~/.zsh_history",
	"~/.local/share/powershell/PSReadLine",
	"~/.node_repl_history",
	"~/.python_history",
];

const SENSITIVE_PATH_PATTERNS = [
	/\bid_rsa\b/i,
	/\bid_ed25519\b/i,
	/\bid_ecdsa\b/i,
	/\bid_dsa\b/i,
	/\bauthorized_keys\b/i,
	/\bknown_hosts\b/i,
	/\.pem\b/i,
	/\.key\b/i,
	/private.*key/i,
	/\.env(\.|$)/i,
	/\.envrc\b/i,
	/aws.*credentials/i,
	/aws.*config/i,
	/\bkeychain\b/i,
	/\bkeyring\b/i,
	/\bLogin Data\b/i,
	/\bCookies\b/i,
	/\bWeb Data\b/i,
	/\bNTUSER\.DAT\b/i,
	/\bSAM\b/i,
	/\bSYSTEM\b/i,
	/\bSECURITY\b/i,
	/\bPSReadLine\b/i,
	/\bConsoleHost_history\.txt\b/i,
	/\bsecurity\s+(find|dump|export)/i,
	/\breg\s+(save|export|query)\b.*\\?(sam|security|system|credentials|password)/i,
	/\blsass\b/i,
	/\bntds\.dit\b/i,
	/\bWindows\/System32\/config\/(SAM|SECURITY|SYSTEM)\b/i,
	/\bMicrosoft\/Protect\b/i,
	/\bVault\b/i,
];

const DANGEROUS_COMMANDS = [
	"rm",
	"rmdir",
	"mv",
	"del",
	"erase",
	"copy",
	"xcopy",
	"robocopy",
	"kill",
	"killall",
	"pkill",
	"taskkill",
	"stop-process",
	"shutdown",
	"reboot",
	"halt",
	"poweroff",
	"init",
	"systemctl",
	"chmod",
	"chown",
	"chgrp",
	"mkfs",
	"fdisk",
	"dd",
	"format",
	"format-volume",
	"sudo",
	"su",
	"doas",
	"env",
	"printenv",
	"export",
	"set",
	"setx",
	"passwd",
	"useradd",
	"userdel",
	"usermod",
	"net user",
	"net localgroup",
	"new-localuser",
	"remove-localuser",
	"set-localuser",
	"groupadd",
	"groupdel",
	"visudo",
	"crontab",
	"schtasks",
	"new-scheduledtask",
	"register-scheduledtask",
	"unregister-scheduledtask",
	"sc delete",
	"sc stop",
	"set-service",
	"stop-service",
	"start-service",
	"remove-service",
	"new-service",
	"reg add",
	"reg delete",
	"reg import",
	"reg save",
	"iptables",
	"netsh advfirewall set",
	"set-mppreference",
	"add-mppreference",
	"remove-mppreference",
	"set-executionpolicy",
	"enable-psremoting",
	"ufw",
	"firewall-cmd",
	"mount",
	"umount",
	"fstab",
	"apt-get remove",
	"apt-get purge",
	"apt remove",
	"apt purge",
	"yum remove",
	"yum erase",
	"dnf remove",
	"pacman -R",
	"brew uninstall",
	"npm uninstall -g",
	"pip uninstall",
	"truncate",
	"shred",
	"wipefs",
	"remove-item",
	"ri",
	"clear-content",
	">",
	">>",
	"git push --force",
	"git push -f",
	"git reset --hard",
	"git clean -fd",
	"docker rm",
	"docker rmi",
	"docker system prune",
	"kubectl delete",
	"terraform destroy",
	"drop database",
	"drop table",
	"delete from",
	"truncate table",
];

const DANGEROUS_PATTERNS = [
	/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*|\s).*\//i,
	/\brm\s+-rf?\s/i,
	/\b(remove-item|ri|del|erase|rmdir)\b.*\s(-recurse|-r|-force|-f)\b/i,
	/\b(remove-item|ri)\b.*\\(Windows|Users|ProgramData|Program Files)\b/i,
	/\bkill\s+-9\b/i,
	/\btaskkill\b.*\/f\b/i,
	/\b(comsvcs\.dll|procdump|rundll32)\b.*\blsass\b/i,
	/\b(minidump|sekurlsa|mimikatz|nanodump|pypykatz|secretsdump|lsassy)\b/i,
	/\breg\s+(save|export)\b.*\\?(sam|security|system)\b/i,
	/\bvssadmin\b.*\b(create|delete|resize)\b/i,
	/\bwbadmin\b.*\bdelete\b/i,
	/\bbcdedit\b.*\b(recoveryenabled|bootstatuspolicy)\b/i,
	/\bwevtutil\b.*\b(clear-log|cl)\b/i,
	/\bClear-EventLog\b/i,
	/\bRemove-EventLog\b/i,
	/\bSet-MpPreference\b.*\b(DisableRealtimeMonitoring|DisableBehaviorMonitoring|DisableIOAVProtection|DisableScriptScanning)\b(?:\s*[:=]?\s*)?(\$true|true|1)\b/i,
	/\bSet-MpPreference\b.*\b(ExclusionPath|ExclusionProcess)\b/i,
	/\bAdd-MpPreference\b.*\b(ExclusionPath|ExclusionProcess|ExclusionExtension)\b/i,
	/\bnetsh\s+advfirewall\s+set\s+allprofiles\s+state\s+off\b/i,
	/\bSet-NetFirewallProfile\b.*\b-Enabled\s+False\b/i,
	/\bSet-ExecutionPolicy\b.*\b(Unrestricted|Bypass)\b/i,
	/\bpowershell(?:\.exe)?\b.*\s-(enc|encodedcommand|w\s+hidden|windowstyle\s+hidden)\b/i,
	/\bpwsh(?:\.exe)?\b.*\s-(enc|encodedcommand|w\s+hidden|windowstyle\s+hidden)\b/i,
	/\bsudo\s/i,
	/\bsu\s+-?\s*$/i,
	/\bchmod\s+[0-7]{3,4}\s/i,
	/\bchown\s/i,
	/\bdd\s+if=/i,
	/>\s*\/dev\/(?!null\b)[a-z]+/i,
	/\|.*\bsh\b/i,
	/\|.*\bbash\b/i,
	/\|.*\b(powershell|pwsh)\b/i,
	/curl.*\|\s*(ba)?sh/i,
	/wget.*\|\s*(ba)?sh/i,
	/\b(iwr|irm|invoke-webrequest|invoke-restmethod)\b.*\|\s*(iex|invoke-expression)/i,
	/eval\s*\$/i,
	/\b(invoke-expression|iex)\b/i,
	/\$\(.*\)/,
	/`.*`/,
	/\benv\s*$/i,
	/\bprintenv\s*$/i,
	/\bexport\s+-p/i,
	/\bget-childitem\s+env:/i,
	/\bdir\s+env:/i,
	/\bset\s*\|/i,
	/echo\s+\$\w*_?(KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS)/i,
	/\b(write-output|echo)\s+\$env:\w*_?(KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS)/i,
];

const BLOCKED_COMMAND_PATTERNS = [
	/\bkillall\b.*\s-9\b/i,
	/\bkill\s+-9\b/i,
	/\btaskkill\b.*\/f\b/i,
	/\bStop-Process\b.*\s-Force\b/i,
	/\b(comsvcs\.dll|procdump|rundll32)\b.*\blsass\b/i,
	/\b(minidump|sekurlsa|mimikatz|nanodump|pypykatz|secretsdump|lsassy)\b/i,
	/\breg\s+(save|export)\b.*\\?(sam|security|system)\b/i,
	/\bvssadmin\b.*\b(create|delete|resize)\b/i,
	/\bwevtutil\b.*\b(clear-log|cl)\b/i,
	/\bClear-EventLog\b/i,
	/\bSet-MpPreference\b.*\b(DisableRealtimeMonitoring|DisableBehaviorMonitoring|DisableIOAVProtection|DisableScriptScanning)\b(?:\s*[:=]?\s*)?(\$true|true|1)\b/i,
	/\bSet-MpPreference\b.*\b(ExclusionPath|ExclusionProcess)\b/i,
	/\bAdd-MpPreference\b.*\b(ExclusionPath|ExclusionProcess|ExclusionExtension)\b/i,
	/\bnetsh\s+advfirewall\s+set\s+allprofiles\s+state\s+off\b/i,
	/\bSet-NetFirewallProfile\b.*\b-Enabled\s+False\b/i,
	/\bSet-ExecutionPolicy\b.*\b(Unrestricted|Bypass)\b/i,
	/\bpowershell(?:\.exe)?\b.*\s-(enc|encodedcommand|w\s+hidden|windowstyle\s+hidden)\b/i,
	/\bpwsh(?:\.exe)?\b.*\s-(enc|encodedcommand|w\s+hidden|windowstyle\s+hidden)\b/i,
	/\bwhile\s+(true|\(\s*\$true\s*\)|\(\s*1\s*\))\s*;?\s*do\b/i,
	/\bfor\s*\(\s*;\s*;\s*\)/i,
	/\bwhile\s*\(\s*\$true\s*\)\s*\{/i,
	/\bwhile\s*\(\s*1\s*\)\s*\{/i,
	/\brm\s+-rf?\s+\/(\s|$)/i,
	/\bRemove-Item\b.*\\(Windows|Users|ProgramData|Program Files)\b.*\s(-Recurse|-Force)\b/i,
	/\bshutdown\b/i,
	/\breboot\b/i,
	/\bpoweroff\b/i,
	/\bformat-volume\b/i,
	/\bformat\s+[a-z]:/i,
	/\breg\s+(add|delete|import)\b/i,
];

function getBlockedCommandReason(command: string): string | null {
	for (const pattern of BLOCKED_COMMAND_PATTERNS) {
		if (pattern.test(command)) {
			return "Command is blocked because it can kill processes, run indefinitely, modify critical system state, or cause data loss.";
		}
	}

	return null;
}

function expandPath(path: string): string {
	if (path.startsWith("~/")) {
		return path.replace("~", homedir());
	}
	if (path === "~") {
		return homedir();
	}
	return path;
}

function isSensitivePathAccess(command: string): boolean {
	const normalizedCmd = command.trim().replace(/\\/g, "/");
	const home = homedir();
	const normalizedHome = home.replace(/\\/g, "/");

	for (const sensitivePath of SENSITIVE_PATHS) {
		const expandedPath = expandPath(sensitivePath).replace(/\\/g, "/");
		if (normalizedCmd.includes(expandedPath)) {
			return true;
		}
		if (sensitivePath.startsWith("~/") && normalizedCmd.includes(sensitivePath)) {
			return true;
		}
		if (normalizedCmd.includes(sensitivePath.replace("~", "$HOME"))) {
			return true;
		}
	}

	for (const pattern of SENSITIVE_PATH_PATTERNS) {
		if (pattern.test(normalizedCmd)) {
			return true;
		}
	}

	const homeAccessPattern = new RegExp(
		`(cat|type|gc|get-content|less|head|tail|more|bat|grep|rg|awk|sed|find|ls|dir|gci|get-childitem|tree|du)\\s+[^|;]*?(~(?:/[^\\s/]+)?(?:\\s|$)|${normalizedHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/[^\\s/]+)?(?:\\s|$))`,
		"i"
	);
	if (homeAccessPattern.test(normalizedCmd)) {
		const allowedHomePaths = [
			"~/projects",
			"~/code",
			"~/dev",
			"~/src",
			"~/repos",
			"~/workspace",
			"~/work",
			"~/.local/bin",
			"~/go",
			"~/bin",
		];
		const isAllowedPath = allowedHomePaths.some((allowed) => {
			const expanded = expandPath(allowed).replace(/\\/g, "/");
			return normalizedCmd.includes(expanded) || normalizedCmd.includes(allowed);
		});
		if (!isAllowedPath) {
			return true;
		}
	}

	return false;
}

function isDangerousCommand(command: string): boolean {
	const normalizedCmd = command.toLowerCase().trim();

	for (const dangerous of DANGEROUS_COMMANDS) {
		if (dangerous.includes(" ")) {
			if (normalizedCmd.includes(dangerous.toLowerCase())) {
				return true;
			}
		} else {
			const escaped = dangerous.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const wordBoundaryRegex = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "i");
			if (wordBoundaryRegex.test(command)) {
				return true;
			}
		}
	}

	for (const pattern of DANGEROUS_PATTERNS) {
		if (pattern.test(command)) {
			return true;
		}
	}

	return false;
}

export type CommandRiskLevel = "read-only" | "sensitive-read" | "modifies-system" | "blocked";

export function classifyCommandRisk(command: string): {
	level: CommandRiskLevel;
	reason: string;
} {
	const blockedReason = getBlockedCommandReason(command);
	if (blockedReason) {
		return { level: "blocked", reason: blockedReason };
	}

	if (isSensitivePathAccess(command)) {
		return {
			level: "sensitive-read",
			reason: "May read sensitive local paths or credential-adjacent data.",
		};
	}

	if (isDangerousCommand(command)) {
		return {
			level: "modifies-system",
			reason: "May modify files, services, users, network state, or system configuration.",
		};
	}

	return {
		level: "read-only",
		reason: "Appears to be finite read-only inspection.",
	};
}

export { getBlockedCommandReason, isDangerousCommand, isSensitivePathAccess };
