import { sanitizeAssistantMessagesForModelHistory } from "../ai/assistant-response-guard";
import {
	applyProactiveSummary,
	createTurnCounter,
	type TurnCounter,
} from "../ai/proactive-summary";
import { compactModelHistoryForContext } from "../ai/context-compaction";
import type { ModelMessage } from "../types";

export class ModelHistoryStore {
	private history: ModelMessage[] = [];
	private turnCounter: TurnCounter = createTurnCounter();

	get(): ModelMessage[] {
		return compactModelHistoryForContext(this.history);
	}

	set(history: ModelMessage[]): void {
		this.history = sanitizeAssistantMessagesForModelHistory(history);
	}

	clear(): void {
		this.history = [];
		this.turnCounter = createTurnCounter();
	}

	appendTurn(userText: string, responseMessages: ModelMessage[]): void {
		this.history.push(
			{ role: "user", content: userText },
			...sanitizeAssistantMessagesForModelHistory(responseMessages)
		);
		this.turnCounter.count += 1;
		this.maybeSummarize();
	}

	/** Apply proactive summary if at the summary interval. */
	private maybeSummarize(): void {
		const summarized = applyProactiveSummary(this.history, this.turnCounter);
		if (summarized > 0) {
			this.turnCounter.summarized += summarized;
		}
	}

	/**
	 * Undo the last turn (user message + assistant response) from the model history.
	 * Returns the number of messages removed, or 0 if nothing to undo.
	 */
	undoLastTurn(): number {
		if (this.history.length === 0) return 0;

		let lastUserIndex = -1;
		for (let i = this.history.length - 1; i >= 0; i--) {
			if (this.history[i]?.role === "user") {
				lastUserIndex = i;
				break;
			}
		}

		if (lastUserIndex === -1) return 0;

		const removedCount = this.history.length - lastUserIndex;
		this.history = this.history.slice(0, lastUserIndex);
		return removedCount;
	}
}
