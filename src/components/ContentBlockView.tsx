/**
 * Component for rendering a single content block: reasoning, tool, or text.
 */

import type { ContentBlock } from "../types";
import { COLORS, REASONING_MARKDOWN_STYLE } from "../ui/constants";
import { renderReasoningTicker } from "../ui/reasoning-ticker";
import { formatElapsedTime, hasVisibleText } from "../utils/formatters";
import { DaemonText } from "./DaemonText";
import { ToolCallView } from "./ToolCallView";

interface ContentBlockViewProps {
	block: ContentBlock;
	isLastReasoningBlock: boolean;
	isLastTextBlock: boolean;
	isLastBlock?: boolean;
	isStreaming: boolean;
	showFullReasoning: boolean;
	showToolOutput?: boolean;
	reasoningDisplay?: string;
	showReasoningTicker?: boolean;
}

export function ContentBlockView({
	block,
	isLastReasoningBlock,
	isLastTextBlock,
	isLastBlock = false,
	isStreaming,
	showFullReasoning,
	showToolOutput = true,
	reasoningDisplay,
	showReasoningTicker,
}: ContentBlockViewProps) {
	if (block.type === "reasoning") {
		if (shouldHideContentBlock(block)) {
			return null;
		}

		const cleanedContent = block.content.replace(/\[REDACTED\]/g, "");

		if (showFullReasoning) {
			const durationLabel =
				block.durationMs !== undefined
					? ` :: ${formatElapsedTime(block.durationMs, { style: "detailed" })}`
					: "";
			return (
				<box
					flexDirection="column"
					border={["left"]}
					borderStyle="heavy"
					borderColor={COLORS.REASONING_DIM}
					paddingLeft={1}
				>
					<text>
						<span fg={COLORS.REASONING}>{"TRACE"}</span>
						<span fg={COLORS.REASONING_DIM}>{durationLabel}</span>
					</text>
					<code
						content={cleanedContent}
						filetype="markdown"
						syntaxStyle={REASONING_MARKDOWN_STYLE}
						streaming={isStreaming && isLastBlock}
						drawUnstyledText={false}
					/>
				</box>
			);
		}

		if (showReasoningTicker && isLastReasoningBlock && reasoningDisplay) {
			return renderReasoningTicker(reasoningDisplay);
		}
		const durationLabel =
			block.durationMs !== undefined
				? ` :: ${formatElapsedTime(block.durationMs, { style: "detailed" })}`
				: "";
		return (
			<text>
				<span fg={COLORS.REASONING_DIM}>
					{"TRACE"}
					{durationLabel}
				</span>
			</text>
		);
	}

	if (block.type === "tool") {
		return (
			<box flexDirection="column">
				<ToolCallView call={block.call} result={block.result} showOutput={showToolOutput} />
			</box>
		);
	}

	if (block.type === "text") {
		return (
			<box flexDirection="column">
				<DaemonText
					content={block.content}
					showLabel={isLastTextBlock && hasVisibleText(block.content)}
					streaming={isStreaming}
				/>
			</box>
		);
	}

	return null;
}

export function isLastTextBlockInList(blocks: ContentBlock[], block: ContentBlock): boolean {
	const lastTextBlock = [...blocks].reverse().find((b) => b.type === "text");
	return lastTextBlock === block;
}

export function isLastReasoningBlockInList(blocks: ContentBlock[], block: ContentBlock): boolean {
	const lastReasoningBlock = [...blocks].reverse().find((b) => b.type === "reasoning");
	return lastReasoningBlock === block;
}

export function shouldHideContentBlock(block: ContentBlock): boolean {
	if (block.type === "reasoning") {
		const cleanedContent = block.content.replace(/\[REDACTED\]/g, "");
		if (cleanedContent.trim().length === 0 && block.content.includes("[REDACTED]")) {
			return true;
		}
	}
	return false;
}
