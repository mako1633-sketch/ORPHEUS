import { promises as fs } from "node:fs";
import path from "node:path";
import { getAppConfigDir } from "../utils/preferences";
import type { AssessmentFinding } from "./windows-assessment-parser";

export interface WindowsAssessmentRecord {
	id: string;
	createdAt: string;
	playbookId: string;
	findings: AssessmentFinding[];
	clientName?: string;
	reportPath?: string;
}

export interface WindowsAssessmentDiff {
	previousId: string | null;
	currentId: string;
	addedFindingIds: string[];
	resolvedFindingIds: string[];
	unchangedFindingIds: string[];
}

const HISTORY_FILE_ENV = "ORPHEUS_WINDOWS_ASSESSMENT_HISTORY_PATH";
const LEGACY_HISTORY_FILE_ENV = "DAEMON_WINDOWS_ASSESSMENT_HISTORY_PATH";

function getHistoryPath(): string {
	const override = process.env[HISTORY_FILE_ENV]?.trim();
	if (override) return override;
	const legacyOverride = process.env[LEGACY_HISTORY_FILE_ENV]?.trim();
	if (legacyOverride) return legacyOverride;
	return path.join(getAppConfigDir(), "windows-assessment-history.json");
}

async function readHistory(): Promise<WindowsAssessmentRecord[]> {
	try {
		const raw = await fs.readFile(getHistoryPath(), "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed as WindowsAssessmentRecord[];
	} catch {
		return [];
	}
}

async function writeHistory(records: WindowsAssessmentRecord[]): Promise<void> {
	const historyPath = getHistoryPath();
	await fs.mkdir(path.dirname(historyPath), { recursive: true });
	await fs.writeFile(historyPath, JSON.stringify(records, null, 2), "utf8");
}

export async function listWindowsAssessmentHistory(): Promise<WindowsAssessmentRecord[]> {
	return readHistory();
}

export function diffWindowsAssessmentRecords(
	current: WindowsAssessmentRecord,
	previous: WindowsAssessmentRecord | null
): WindowsAssessmentDiff {
	const currentIds = new Set(current.findings.map((finding) => finding.id));
	const previousIds = new Set(previous?.findings.map((finding) => finding.id) ?? []);

	return {
		previousId: previous?.id ?? null,
		currentId: current.id,
		addedFindingIds: [...currentIds].filter((id) => !previousIds.has(id)).sort(),
		resolvedFindingIds: [...previousIds].filter((id) => !currentIds.has(id)).sort(),
		unchangedFindingIds: [...currentIds].filter((id) => previousIds.has(id)).sort(),
	};
}

export async function saveWindowsAssessmentRecord(params: {
	playbookId: string;
	findings: AssessmentFinding[];
	clientName?: string;
	reportPath?: string;
}): Promise<{ record: WindowsAssessmentRecord; diff: WindowsAssessmentDiff }> {
	const records = await readHistory();
	const previous = params.clientName
		? (records.find((item) => item.clientName?.toLowerCase() === params.clientName?.toLowerCase()) ?? null)
		: (records[0] ?? null);
	const record: WindowsAssessmentRecord = {
		id: crypto.randomUUID(),
		createdAt: new Date().toISOString(),
		playbookId: params.playbookId,
		findings: params.findings,
		clientName: params.clientName,
		reportPath: params.reportPath,
	};
	const next = [record, ...records].slice(0, 25);
	await writeHistory(next);
	return {
		record,
		diff: diffWindowsAssessmentRecords(record, previous),
	};
}
