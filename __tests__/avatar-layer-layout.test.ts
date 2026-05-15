import { describe, expect, it } from "bun:test";

import { calculateHomeGifLayout } from "../src/app/components/AvatarLayer";

describe("calculateHomeGifLayout", () => {
	it("uses the full viewport for the home GIF", () => {
		const layout = calculateHomeGifLayout({
			viewportWidth: 180,
			viewportHeight: 50,
			showBanner: true,
		});

		expect(layout.width).toBeGreaterThan(120);
		expect(layout.height).toBeGreaterThan(34);
		expect(layout.top).toBeGreaterThanOrEqual(0);
	});

	it("keeps the home GIF within small terminal bounds", () => {
		const layout = calculateHomeGifLayout({
			viewportWidth: 100,
			viewportHeight: 30,
			showBanner: true,
		});

		expect(layout.width).toBeLessThanOrEqual(96);
		expect(layout.height).toBeLessThanOrEqual(21);
		expect(layout.top + layout.height).toBeLessThanOrEqual(30);
	});
});
