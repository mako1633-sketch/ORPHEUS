export interface ProcessSignalInput {
	name: string;
	path?: string;
	signed?: boolean;
	listeningPort?: number;
	runsAsAdmin?: boolean;
	company?: string;
	recentlyCreated?: boolean;
	parentProcess?: string;
}

export interface ProcessScore {
	score: number;
	severity: "low" | "medium" | "high";
	reasons: string[];
}

function isUserWritablePath(path: string): boolean {
	return /\\Users\\|\\Temp\\|\\AppData\\|\\Downloads\\/i.test(path);
}

export function scoreWindowsProcess(input: ProcessSignalInput): ProcessScore {
	let score = 0;
	const reasons: string[] = [];

	if (input.path && isUserWritablePath(input.path)) {
		score += 25;
		reasons.push("Binary path appears user-writable.");
	}
	if (input.signed === false) {
		score += 25;
		reasons.push("Binary is unsigned or signature could not be verified.");
	}
	if (typeof input.listeningPort === "number") {
		score += 20;
		reasons.push(`Process owns listening port ${input.listeningPort}.`);
	}
	if (input.runsAsAdmin) {
		score += 15;
		reasons.push("Process appears elevated or high privilege.");
	}
	if (!input.company) {
		score += 10;
		reasons.push("Company metadata is missing.");
	}
	if (input.recentlyCreated) {
		score += 10;
		reasons.push("Binary or process metadata appears recently created.");
	}
	if (
		input.parentProcess &&
		/winword|excel|outlook|browser|chrome|edge|firefox/i.test(input.parentProcess)
	) {
		score += 15;
		reasons.push(`Parent process ${input.parentProcess} is unusual for a persistent process.`);
	}

	const severity = score >= 60 ? "high" : score >= 30 ? "medium" : "low";
	return { score: Math.min(score, 100), severity, reasons };
}
