import type { KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useCallback, useMemo, useState } from "react";
import { COLORS } from "../ui/constants";

export interface CommandPaletteItem {
	id: string;
	label: string;
	shortcut?: string;
	action: () => void;
}

interface CommandPaletteProps {
	items: CommandPaletteItem[];
	onClose: () => void;
}

function fuzzyScore(query: string, text: string): number {
	const q = query.toLowerCase();
	const t = text.toLowerCase();
	if (t.startsWith(q)) return 3;
	if (t.includes(q)) return 2;
	// Check acronym match (e.g., "sc" matches "Security Scan")
	const acronym = t
		.split(/\s+/)
		.map((w) => w[0])
		.join("");
	if (acronym.startsWith(q)) return 1;
	return 0;
}

export function CommandPalette({ items, onClose }: CommandPaletteProps) {
	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);

	const filtered = useMemo(() => {
		if (!query.trim()) return items;
		const scored = items
			.map((item) => ({ item, score: fuzzyScore(query, item.label) }))
			.filter((s) => s.score > 0)
			.sort((a, b) => b.score - a.score);
		return scored.map((s) => s.item);
	}, [query, items]);

	const handleKeyPress = useCallback(
		(key: KeyEvent) => {
			if (key.eventType !== "press") return;

			if (key.name === "escape") {
				onClose();
				key.preventDefault();
				return;
			}

			if (key.name === "up") {
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
				key.preventDefault();
				return;
			}

			if (key.name === "down") {
				setSelectedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
				key.preventDefault();
				return;
			}

			if (key.name === "return") {
				const item = filtered[selectedIndex];
				if (item) {
					item.action();
				}
				key.preventDefault();
				return;
			}

			// Backspace is handled by input; other printable keys accumulate in query via input
			if (key.name === "backspace") {
				setQuery((prev) => prev.slice(0, -1));
				setSelectedIndex(0);
				key.preventDefault();
				return;
			}
		},
		[filtered, selectedIndex, onClose]
	);

	useKeyboard(handleKeyPress);

	const labelWidth = Math.max(0, ...filtered.map((item) => item.label.length)) + 4;

	return (
		<box
			position="absolute"
			left={0}
			top={0}
			width="100%"
			height="100%"
			flexDirection="column"
			alignItems="center"
			justifyContent="center"
			zIndex={100}
		>
			<box
				flexDirection="column"
				backgroundColor={COLORS.MENU_BG}
				borderStyle="single"
				borderColor={COLORS.MENU_BORDER}
				paddingLeft={2}
				paddingRight={2}
				paddingTop={1}
				paddingBottom={1}
				width="60%"
				minWidth={50}
				maxWidth={130}
			>
				<box marginBottom={1}>
					<text>
						<span fg={COLORS.DAEMON_LABEL}>[ ORPHEUS COMMAND PALETTE ]</span>
					</text>
				</box>
				<box marginBottom={1} flexDirection="row" alignItems="center">
					<text>
						<span fg={COLORS.DAEMON_LABEL}>{"> "}</span>
					</text>
					<text>
						<span fg={COLORS.MENU_TEXT}>{query}</span>
						{query.length === 0 && <span fg={COLORS.REASONING_DIM}>Type to filter...</span>}
					</text>
				</box>
				<box marginBottom={1}>
					<text>
						<span fg={COLORS.USER_LABEL}>
							{filtered.length} commands · ↑/↓ navigate · ENTER run · ESC close
						</span>
					</text>
				</box>
				<box flexDirection="column">
					{filtered.map((item, idx) => {
						const isSelected = idx === selectedIndex;
						return (
							<box
								key={item.id}
								backgroundColor={isSelected ? COLORS.MENU_SELECTED_BG : COLORS.MENU_BG}
								paddingLeft={1}
								paddingRight={1}
								flexDirection="column"
							>
								<box flexDirection="row">
									<box width={labelWidth}>
										<text>
											<span fg={isSelected ? COLORS.DAEMON_LABEL : COLORS.MENU_TEXT}>
												{isSelected ? "▶ " : "  "}
												{item.label}
											</span>
										</text>
									</box>
									{item.shortcut && (
										<box>
											<text>
												<span fg={COLORS.REASONING_DIM}>{item.shortcut}</span>
											</text>
										</box>
									)}
								</box>
							</box>
						);
					})}
					{filtered.length === 0 && (
						<box paddingLeft={1}>
							<text>
								<span fg={COLORS.REASONING_DIM}>No matching commands</span>
							</text>
						</box>
					)}
				</box>
			</box>
		</box>
	);
}
