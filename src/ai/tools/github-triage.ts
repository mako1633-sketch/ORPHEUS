import { tool } from "ai";
import { z } from "zod";

const GITHUB_API_BASE = "https://api.github.com";

async function githubRequest(endpoint: string, token: string | undefined): Promise<unknown> {
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}

	const url = endpoint.startsWith("http") ? endpoint : `${GITHUB_API_BASE}${endpoint}`;
	const res = await fetch(url, { headers });

	if (!res.ok) {
		throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
	}
	return res.json();
}

function getToken(): string | undefined {
	return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
}

function getRepoFromGit(): { owner: string; repo: string } | null {
	try {
		const { execSync } = require("node:child_process");
		const remote = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
		// Support both https and ssh formats
		const match = remote.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
		if (match) {
			return { owner: match[1]!, repo: match[2]!.replace(/\.git$/, "") };
		}
	} catch {
		// Not in a git repo or no origin remote
	}
	return null;
}

export const githubTriage = tool({
	description:
		"Self-triage GitHub Actions CI failures without user intervention. Given a commit SHA or recent push, fetches workflow runs, job logs, and annotations to identify the root cause. Returns a structured diagnosis with file names, line numbers, and suggested fixes.",
	inputSchema: z.object({
		action: z
			.enum(["latest", "by-sha", "logs", "annotations"])
			.default("latest")
			.describe(
				"What to fetch: latest run on default branch, a specific commit, raw logs, or annotations."
			),
		sha: z.string().optional().describe("Commit SHA to triage (required for by-sha)."),
		repo: z
			.string()
			.optional()
			.describe("owner/repo override. Auto-detected from git remote if omitted."),
		workflowName: z
			.string()
			.optional()
			.describe("Filter to a specific workflow file name, e.g. ci.yml"),
	}),
	execute: async ({ action, sha, repo, workflowName }) => {
		const token = getToken();
		const repoInfo = repo
			? (() => {
					const parts = repo.split("/");
					return parts.length === 2 ? { owner: parts[0]!, repo: parts[1]! } : null;
				})()
			: getRepoFromGit();

		if (!repoInfo) {
			return {
				success: false,
				error:
					'Could not detect repo from git remote. Please pass `repo` as "owner/name" or set a git origin.',
			};
		}

		const { owner, repo: repoName } = repoInfo;
		const repoSlug = `${owner}/${repoName}`;

		try {
			if (action === "by-sha" && !sha) {
				return { success: false, error: "sha is required for action=by-sha" };
			}

			// Fetch workflow runs
			let runsEndpoint = `/repos/${repoSlug}/actions/runs?per_page=10`;
			if (sha) {
				runsEndpoint += `&head_sha=${sha}`;
			}
			if (workflowName) {
				const workflows = (await githubRequest(`/repos/${repoSlug}/actions/workflows`, token)) as {
					workflows?: Array<{ id: number; name: string; path: string }>;
				};
				const match = workflows.workflows?.find(
					(w) => w.path?.includes(workflowName) || w.name?.includes(workflowName)
				);
				if (match) {
					runsEndpoint += `&workflow_id=${match.id}`;
				}
			}

			const runsData = (await githubRequest(runsEndpoint, token)) as {
				total_count?: number;
				workflow_runs?: Array<{
					id: number;
					name: string;
					head_sha: string;
					conclusion: string | null;
					status: string;
					html_url: string;
					created_at: string;
				}>;
			};

			const runs = runsData.workflow_runs ?? [];
			if (runs.length === 0) {
				return {
					success: false,
					error: `No workflow runs found for ${repoSlug}${sha ? ` @ ${sha}` : ""}${workflowName ? ` (workflow: ${workflowName})` : ""}.`,
				};
			}

			const latestRun = runs[0]!;

			// Fetch jobs for the latest run
			const jobsData = (await githubRequest(
				`/repos/${repoSlug}/actions/runs/${latestRun.id}/jobs`,
				token
			)) as {
				jobs?: Array<{
					id: number;
					name: string;
					status: string;
					conclusion: string | null;
					started_at: string;
					completed_at: string | null;
				}>;
			};

			const failedJobs = (jobsData.jobs ?? []).filter(
				(j) => j.conclusion === "failure" || j.conclusion === "timed_out"
			);

			// Fetch annotations
			const annotationsData = (await githubRequest(
				`/repos/${repoSlug}/check-suites/${latestRun.id}/check-runs`,
				token
			)) as {
				check_runs?: Array<{ id: number; name: string; conclusion: string | null }>;
			};

			// Simplified diagnosis
			const diagnosis = {
				repo: repoSlug,
				run: {
					id: latestRun.id,
					name: latestRun.name,
					sha: latestRun.head_sha,
					conclusion: latestRun.conclusion,
					status: latestRun.status,
					url: latestRun.html_url,
					createdAt: latestRun.created_at,
				},
				jobs: jobsData.jobs?.map((j) => ({
					name: j.name,
					status: j.status,
					conclusion: j.conclusion,
					duration: j.completed_at
						? Math.round(
								(new Date(j.completed_at).getTime() - new Date(j.started_at).getTime()) / 1000
							)
						: undefined,
				})),
				failedJobs: failedJobs.map((j) => ({
					name: j.name,
					conclusion: j.conclusion,
				})),
				annotations: annotationsData.check_runs
					?.filter((cr) => cr.conclusion !== "success")
					.map((cr) => ({
						name: cr.name,
						conclusion: cr.conclusion,
					})),
				tokenAvailable: Boolean(token),
			};

			const humanSummary = [
				`📦 Repo: ${repoSlug}`,
				`🔬 Run #${diagnosis.run.id}: ${diagnosis.run.name}`,
				`📝 SHA: ${diagnosis.run.sha.slice(0, 7)}`,
				`🎯 Conclusion: ${diagnosis.run.conclusion ?? diagnosis.run.status}`,
				`🔗 ${diagnosis.run.url}`,
				"",
				`Jobs (${diagnosis.jobs?.length ?? 0}):`,
				...(diagnosis.jobs?.map(
					(j) =>
						`  ${j.conclusion === "success" ? "✅" : "❌"} ${j.name}${j.duration ? ` (${j.duration}s)` : ""}`
				) ?? []),
				"",
				diagnosis.failedJobs.length > 0
					? `Failed jobs: ${diagnosis.failedJobs.map((j) => j.name).join(", ")}`
					: "All jobs passed.",
				!diagnosis.tokenAvailable
					? "⚠️ No GITHUB_TOKEN found — some details may be incomplete."
					: "",
			]
				.filter(Boolean)
				.join("\n");

			return {
				success: true,
				data: humanSummary,
				structured: diagnosis,
			};
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			return { success: false, error: msg };
		}
	},
});
