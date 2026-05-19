/**
 * Hook that enforces ORPHEUS startup protocol on session start.
 * Runs the startup script once per application lifecycle.
 */

import { useEffect, useRef, useState } from "react";
import { toast } from "@opentui-ui/toast/react";
import {
	hasStartupRun,
	isSessionReady,
	runStartupProtocol,
	type StartupResult,
} from "../utils/startup-protocol";

export interface StartupEnforcementResult {
	startupResult: StartupResult | null;
	isRunning: boolean;
	hasCompleted: boolean;
	isReady: boolean;
	wasSkipped: boolean;
}

export function useStartupEnforcement({
	enabled,
	skipIfAlreadyRun,
}: {
	enabled: boolean;
	skipIfAlreadyRun: boolean;
}): StartupEnforcementResult {
	const [startupResult, setStartupResult] = useState<StartupResult | null>(null);
	const [isRunning, setIsRunning] = useState(false);
	const [hasCompleted, setHasCompleted] = useState(false);
	const runRef = useRef(false);

	useEffect(() => {
		if (!enabled || runRef.current) return;

		if (skipIfAlreadyRun && hasStartupRun()) {
			setHasCompleted(true);
			return;
		}

		runRef.current = true;
		setIsRunning(true);

		runStartupProtocol()
			.then((result) => {
				setStartupResult(result);
				setHasCompleted(true);

				if (result.status === "ok") {
					toast.success("ORPHEUS startup: fully operational", {
						description: `Protocol completed in ${result.durationMs}ms`,
					});
				} else if (result.status === "warnings") {
					toast.warning("ORPHEUS startup: warnings detected", {
						description: result.stderr.slice(0, 120) || "Non-critical issues found",
					});
				} else {
					toast.error("ORPHEUS startup: critical blockers", {
						description: result.stderr.slice(0, 200) || "Session readiness blocked",
					});
				}
			})
			.catch((err: unknown) => {
				const message = err instanceof Error ? err.message : String(err);
				setStartupResult({
					status: "critical",
					exitCode: 1,
					stdout: "",
					stderr: message,
					durationMs: 0,
					lastRunAt: Date.now(),
				});
				setHasCompleted(true);
				toast.error("ORPHEUS startup: failed to run", {
					description: message.slice(0, 200),
				});
			})
			.finally(() => {
				setIsRunning(false);
			});
	}, [enabled, skipIfAlreadyRun]);

	return {
		startupResult,
		isRunning,
		hasCompleted,
		isReady: isSessionReady(),
		wasSkipped: skipIfAlreadyRun && hasStartupRun() && !hasCompleted,
	};
}
