import { sanitizeAssistantMessagesForModelHistory } from "../ai/assistant-response-guard";
import { compactModelHistoryForContext } from "../ai/context-compaction";
import {
	applyProactiveSummary,
	createTurnCounter,
	type TurnCounter,
} from "../ai/proactive-summary";
import type { AttachmentInfo, ModelMessage } from "../types";

/** Build AI SDK user message content parts from text + attachments */
function buildUserContentParts(
	text: string,
	attachments?: AttachmentInfo[]
):
	| string
	| Array<
			| { type: "text"; text: string }
			| { type: "image"; image: string; mediaType?: string }
			| { type: "file"; data: string; filename?: string; mediaType: string }
	  > {
	if (!attachments || attachments.length === 0) return text;

	const parts: Array<
		| { type: "text"; text: string }
		| { type: "image"; image: string; mediaType?: string }
		| { type: "file"; data: string; filename?: string; mediaType: string }
	> = [];

	if (text.trim()) {
		parts.push({ type: "text", text });
	}

	for (const att of attachments) {
		if (att.isImage) {
			parts.push({ type: "image", image: att.data, mediaType: att.mimeType });
		} else {
			parts.push({ type: "file", data: att.data, filename: att.name, mediaType: att.mimeType });
		}
	}

	return parts;
}

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

	appendTurn(
		userText: string,
		responseMessages: ModelMessage[],
		attachments?: AttachmentInfo[]
	): void {
		const content = buildUserContentParts(userText, attachments);
		this.history.push(
			{ role: "user", content },
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
