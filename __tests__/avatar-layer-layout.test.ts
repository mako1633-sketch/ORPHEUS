import { describe, expect, it } from "bun:test";
import { calculateChatGifLayout, calculateHomeGifLayout } from "../src/app/components/AvatarLayer";

describe("calculateHomeGifLayout", () => {
	it("reserves top space when banner is shown", () => {
		const layout = calculateHomeGifLayout({
			viewportWidth: 100,
			viewportHeight: 50,
			showBanner: true,
		});
		expect(layout.width).toBeGreaterThanOrEqual(1);
		expect(layout.height).toBeGreaterThanOrEqual(1);
		expect(layout.top).toBeGreaterThanOrEqual(13);
		expect(layout.top + layout.height).toBeLessThanOrEqual(35);
	});

	it("uses full height when banner is not shown", () => {
		const layout = calculateHomeGifLayout({
			viewportWidth: 100,
			viewportHeight: 50,
			showBanner: false,
		});
		expect(layout.width).toBeGreaterThanOrEqual(1);
		expect(layout.height).toBeGreaterThanOrEqual(1);
		expect(layout.top).toBeGreaterThanOrEqual(0);
	});

	it("clamps width to min and max limits", () => {
		const tiny = calculateHomeGifLayout({
			viewportWidth: 10,
			viewportHeight: 20,
			showBanner: false,
		});
		expect(tiny.width).toBeLessThanOrEqual(10);

		const huge = calculateHomeGifLayout({
			viewportWidth: 500,
			viewportHeight: 200,
			showBanner: false,
		});
		expect(huge.width).toBeLessThanOrEqual(168);
	});
});

describe("calculateChatGifLayout", () => {
	it("scales proportionally to viewport width", () => {
		const small = calculateChatGifLayout({ viewportWidth: 60 });
		const large = calculateChatGifLayout({ viewportWidth: 200 });
		expect(large.width).toBeGreaterThan(small.width);
		expect(small.width).toBeGreaterThanOrEqual(24);
		expect(large.width).toBeLessThanOrEqual(40);
	});

	it("returns fixed top and right offsets", () => {
		const layout = calculateChatGifLayout({ viewportWidth: 100 });
		expect(layout.top).toBe(4);
		expect(layout.right).toBe(2);
	});

	it("always returns positive dimensions", () => {
		const layout = calculateChatGifLayout({ viewportWidth: 1 });
		expect(layout.width).toBeGreaterThanOrEqual(1);
		expect(layout.height).toBeGreaterThanOrEqual(1);
	});
});
