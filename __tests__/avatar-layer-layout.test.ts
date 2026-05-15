import { describe, expect, it } from "bun:test";

import { calculateChatGifLayout } from "../src/app/components/AvatarLayer";

describe("calculateChatGifLayout", () => {
	it("keeps the chat GIF compact in the upper right", () => {
		const layout = calculateChatGifLayout({ viewportWidth: 160 });

		expect(layout.width).toBeGreaterThanOrEqual(14);
		expect(layout.width).toBeLessThanOrEqual(22);
		expect(layout.height).toBeLessThanOrEqual(7);
		expect(layout.top).toBe(4);
		expect(layout.right).toBe(2);
	});

	it("can move below the startup banner without growing", () => {
		const layout = calculateChatGifLayout({ viewportWidth: 180, top: 9 });

		expect(layout.width).toBeLessThanOrEqual(22);
		expect(layout.height).toBeLessThanOrEqual(7);
		expect(layout.top).toBe(9);
	});
});
