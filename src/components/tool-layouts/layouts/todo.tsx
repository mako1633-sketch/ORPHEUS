import { TextAttributes } from "@opentui/core";
import { COLORS } from "../../../ui/constants";
import { type FormattedTodoItem, formatTodoDisplayLines, isTodoInput } from "../../../utils/formatters";
import { registerToolLayout } from "../registry";
import type { ToolHeader, ToolLayoutConfig, ToolLayoutRenderProps } from "../types";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractTodoAction(input: unknown): string | null {
	if (!isRecord(input)) return null;
	if ("action" in input && typeof input.action === "string") {
		return input.action;
	}
	return null;
}

function getTodoColor(status: string): string {
	switch (status) {
		case "in_progress":
			return COLORS.STATUS_RUNNING;
		case "completed":
		case "cancelled":
			return COLORS.STATUS_DONE_DIM;
		default:
			return COLORS.STATUS_PENDING;
	}
}

function getTodoAttributes(status: string): number {
	if (status === "completed" || status === "cancelled") {
		return TextAttributes.STRIKETHROUGH;
	}
	return TextAttributes.NONE;
}

function TodoBody({ call }: ToolLayoutRenderProps) {
	if (!isTodoInput(call.input)) {
		return null;
	}

	const lines = formatTodoDisplayLines(call.input, call.todoSnapshot);

	if (lines.length === 0) {
		return null;
	}

	return (
		<box flexDirection="column" paddingLeft={2}>
			{lines.map((item: FormattedTodoItem, idx: number) => (
				<text key={idx}>
					<span fg={getTodoColor(item.status)} attributes={getTodoAttributes(item.status)}>
						{item.text}
					</span>
				</text>
			))}
		</box>
	);
}

export const todoLayout: ToolLayoutConfig = {
	abbreviation: "todo",

	getHeader: (input): ToolHeader | null => {
		const action = extractTodoAction(input);
		return action ? { secondary: action } : null;
	},

	renderBody: TodoBody,
};

registerToolLayout("todoManager", todoLayout);
