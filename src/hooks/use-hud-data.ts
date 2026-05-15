import { useEffect, useState } from "react";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadTaskStack } from "../ai/task-stack-state";

const execFileAsync = promisify(execFile);

export interface HudData {
	gitDirty: boolean;
	gitBranch: string | null;
	activeTasks: number;
	queuedTasks: number;
}

export function useHudData(): HudData {
	const [data, setData] = useState<HudData>({
		gitDirty: false,
		gitBranch: null,
		activeTasks: 0,
		queuedTasks: 0,
	});

	useEffect(() => {
		let cancelled = false;

		async function fetchHud() {
			try {
				const [gitResult, tasks] = await Promise.all([
					execFileAsync("git", ["status", "--porcelain"], { timeout: 2000 }).catch(() => null),
					loadTaskStack().catch(() => ({ items: [] })),
				]);

				if (cancelled) return;

				const gitDirty = gitResult ? gitResult.stdout.trim().length > 0 : false;
				let gitBranch: string | null = null;
				try {
					const branchResult = await execFileAsync("git", ["branch", "--show-current"], {
						timeout: 1000,
					});
					gitBranch = branchResult.stdout.trim() || null;
				} catch {
					// ignore branch fetch failure
				}

				const activeTasks = tasks.items.filter((t) => t.status === "active").length;
				const queuedTasks = tasks.items.filter(
					(t) => t.status === "queued" || t.status === "blocked"
				).length;

				setData({ gitDirty, gitBranch, activeTasks, queuedTasks });
			} catch {
				// ignore failures; HUD is best-effort
			}
		}

		fetchHud();
		const interval = setInterval(fetchHud, 30000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, []);

	return data;
}
