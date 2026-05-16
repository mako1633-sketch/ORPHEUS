import { describe, expect, it } from "bun:test";

import {
	groundingItemsSchema,
	groundingManagerInputSchema,
} from "../src/ai/tools/grounding-manager";

const groundingItems = [
	{
		id: "g1",
		statement: "ORPHEUS supports local Signal messaging through signal-cli.",
		source: {
			url: "https://example.com/signal",
			quote: "signal-cli can send and receive messages from the command line.",
			textFragment: "send and receive messages",
		},
	},
];

describe("groundingItemsSchema", () => {
	it("accepts structured arrays", () => {
		const parsed = groundingItemsSchema.parse(groundingItems);
		expect(parsed).toEqual(groundingItems);
	});

	it("accepts JSON-stringified arrays", () => {
		const parsed = groundingItemsSchema.parse(JSON.stringify(groundingItems));
		expect(parsed).toEqual(groundingItems);
	});

	it("normalizes aliases and derives missing textFragment", () => {
		const parsed = groundingItemsSchema.parse([
			{
				id: "g1",
				claim: "ORPHEUS can ground sourced claims.",
				source: {
					href: "https://example.com/grounding",
					text: "Grounding connects a claim to supporting source text.",
				},
			},
		]);

		expect(parsed).toEqual([
			{
				id: "g1",
				statement: "ORPHEUS can ground sourced claims.",
				source: {
					url: "https://example.com/grounding",
					quote: "Grounding connects a claim to supporting source text.",
					textFragment: "Grounding connects a claim to supporting source text.",
				},
			},
		]);
	});
});

describe("groundingManagerInputSchema", () => {
	it("accepts full input with structured items", () => {
		const parsed = groundingManagerInputSchema.parse({
			action: "set",
			items: groundingItems,
		});

		expect(parsed).toEqual({ action: "set", items: groundingItems });
	});

	it("accepts full input with JSON-stringified items", () => {
		const parsed = groundingManagerInputSchema.parse({
			action: "set",
			items: JSON.stringify(groundingItems),
		});

		expect(parsed).toEqual({ action: "set", items: groundingItems });
	});

	it("accepts a JSON-stringified full input object", () => {
		const parsed = groundingManagerInputSchema.parse(
			JSON.stringify({
				action: "append",
				items: groundingItems,
			})
		);

		expect(parsed).toEqual({ action: "append", items: groundingItems });
	});

	it("normalizes item and source aliases in full inputs", () => {
		const parsed = groundingManagerInputSchema.parse({
			action: "set",
			items: [
				{
					id: "g1",
					text: "Windows Defender is a built-in Windows protection.",
					source: {
						link: "https://example.com/defender",
						excerpt: "Microsoft Defender Antivirus is included with Windows.",
					},
				},
			],
		});

		expect(parsed.items[0]).toEqual({
			id: "g1",
			statement: "Windows Defender is a built-in Windows protection.",
			source: {
				url: "https://example.com/defender",
				quote: "Microsoft Defender Antivirus is included with Windows.",
				textFragment: "Microsoft Defender Antivirus is included with Windows.",
			},
		});
	});

	it("rejects empty URLs, empty quotes, and missing statements", () => {
		expect(() =>
			groundingManagerInputSchema.parse({
				action: "set",
				items: [{ id: "g1", statement: "Claim", source: { url: "", quote: "Quote" } }],
			})
		).toThrow();

		expect(() =>
			groundingManagerInputSchema.parse({
				action: "set",
				items: [
					{ id: "g1", statement: "Claim", source: { url: "https://example.com", quote: "" } },
				],
			})
		).toThrow();

		expect(() =>
			groundingManagerInputSchema.parse({
				action: "set",
				items: [{ id: "g1", source: { url: "https://example.com", quote: "Quote" } }],
			})
		).toThrow();
	});
});
