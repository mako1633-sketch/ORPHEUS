/**
 * Shared helper for building user messages with file attachments.
 * Converts text + AttachmentInfo[] into AI SDK ModelMessage content parts.
 */

import type { AttachmentInfo, ModelMessage } from "../../types";

/**
 * Build a user message ModelMessage that includes text and any attachments
 * as content parts. Returns the standard `{ role: 'user', content: ... }`
 * shape that the AI SDK accepts.
 */
export function buildUserModelMessage(
	userText: string,
	attachments?: AttachmentInfo[]
): ModelMessage {
	if (!attachments || attachments.length === 0) {
		return { role: "user", content: userText };
	}

	const parts: Array<
		| { type: "text"; text: string }
		| { type: "image"; image: string; mediaType?: string }
		| { type: "file"; data: string; filename?: string; mediaType: string }
	> = [];

	if (userText.trim()) {
		parts.push({ type: "text", text: userText });
	}

	for (const att of attachments) {
		if (att.isImage) {
			parts.push({ type: "image", image: att.data, mediaType: att.mimeType });
		} else {
			parts.push({
				type: "file",
				data: att.data,
				filename: att.name,
				mediaType: att.mimeType,
			});
		}
	}

	return { role: "user", content: parts };
}
