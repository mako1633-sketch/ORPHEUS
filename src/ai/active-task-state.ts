export type ActiveTaskKind = "windows-assessment" | "setup-doctor" | "coding" | "general";

export interface ActiveTaskState {
	kind: ActiveTaskKind;
	summary: string;
	nextStep?: string;
	updatedAt: string;
}

let activeTaskState: ActiveTaskState | null = null;

export function setActiveTaskState(state: Omit<ActiveTaskState, "updatedAt">): ActiveTaskState {
	activeTaskState = {
		...state,
		updatedAt: new Date().toISOString(),
	};
	return activeTaskState;
}

export function getActiveTaskState(): ActiveTaskState | null {
	return activeTaskState;
}

export function clearActiveTaskState(): void {
	activeTaskState = null;
}

export function buildActiveTaskContext(): string {
	if (!activeTaskState) return "";
	const next = activeTaskState.nextStep ? ` Next step: ${activeTaskState.nextStep}` : "";
	return `<active-task kind="${activeTaskState.kind}" updatedAt="${activeTaskState.updatedAt}">${activeTaskState.summary}.${next}</active-task>`;
}
