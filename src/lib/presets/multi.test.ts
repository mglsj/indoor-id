import { describe, expect, it } from "vitest";
import {
	chipsIn,
	chipsOver,
	combineTags,
	isMixed,
	tagDiff,
	withoutChip,
} from "./multi.ts";
import type { Field } from "./presets.ts";

describe("combineTags: the tags of several features, as one editor shows them", () => {
	it("gives one feature's tags as they are, nothing mixed", () => {
		const combined = combineTags([{ indoor: "room", level: "0" }]);
		expect(combined.tags).toEqual({ indoor: "room", level: "0" });
		expect(combined.mixed.size).toBe(0);
	});

	it("keeps the values all features share, and lists each feature's value of the others", () => {
		const combined = combineTags([
			{ indoor: "room", level: "0", name: "A" },
			{ indoor: "room", level: "1" },
			{ indoor: "room", level: "0", name: "A" },
		]);
		expect(combined.tags).toEqual({ indoor: "room" });
		expect(combined.mixed.get("level")).toEqual(["0", "1", "0"]);
		// A key only some features have is mixed too.
		expect(combined.mixed.get("name")).toEqual(["A", undefined, "A"]);
		expect(isMixed(combined, "level")).toBe(true);
		expect(isMixed(combined, "indoor")).toBe(false);
	});

	it("has nothing for no feature", () => {
		const combined = combineTags([]);
		expect(combined.tags).toEqual({});
		expect(combined.mixed.size).toBe(0);
	});
});

describe("chipsIn: a list field's values over several features", () => {
	it("tells the values every feature has from those only some have", () => {
		const combined = combineTags([
			{ cuisine: "pizza;burger" },
			{ cuisine: "burger" },
			{},
		]);
		expect(chipsIn(combined, "cuisine")).toEqual([
			{ value: "pizza", all: false },
			{ value: "burger", all: false },
		]);
		expect(
			chipsIn(
				combineTags([{ cuisine: "pizza;burger" }, { cuisine: "burger;sushi" }]),
				"cuisine",
			),
		).toEqual([
			{ value: "pizza", all: false },
			{ value: "burger", all: true },
			{ value: "sushi", all: false },
		]);
	});

	it("gives a shared list's values, all of them on every feature", () => {
		expect(
			chipsIn(combineTags([{ cuisine: "pizza; sushi" }]), "cuisine"),
		).toEqual([
			{ value: "pizza", all: true },
			{ value: "sushi", all: true },
		]);
		expect(chipsIn(combineTags([{}]), "cuisine")).toEqual([]);
	});
});

const field = (extra: Partial<Field>): Field => ({
	id: "f",
	key: "cuisine",
	type: "semiCombo",
	label: "Cuisine",
	options: [{ value: "pizza", label: "Pizza" }],
	terms: [],
	universal: false,
	snakeCase: true,
	caseSensitive: false,
	customValues: true,
	autoSuggestions: false,
	allowDuplicates: false,
	...extra,
});

describe("chipsOver: a chip field's chips over several features", () => {
	it("marks a list's values only some features have", () => {
		const combined = combineTags([
			{ cuisine: "pizza;burger" },
			{ cuisine: "burger" },
		]);
		expect(chipsOver(field({}), combined).map((c) => [c.label, c.all])).toEqual(
			[
				["Pizza", false],
				["burger", true],
			],
		);
	});

	it("shows a key set on only some features without a state", () => {
		const payment = field({ key: "payment:", type: "multiCombo", options: [] });
		const combined = combineTags([
			{ "payment:cash": "yes", "payment:card": "yes" },
			{ "payment:cash": "yes" },
		]);
		expect(
			chipsOver(payment, combined).map((c) => [c.key, c.state, c.all]),
		).toEqual([
			["payment:cash", "yes", true],
			["payment:card", undefined, false],
		]);
	});
});

describe("withoutChip: a chip taken off one feature's own tags", () => {
	it("removes the value from that feature's list, or its key", () => {
		const chip = { key: "cuisine", value: "pizza" };
		expect(withoutChip(field({}), { cuisine: "burger;pizza" }, chip)).toEqual({
			cuisine: "burger",
		});
		expect(withoutChip(field({}), { cuisine: "pizza" }, chip)).toEqual({
			cuisine: undefined,
		});
		expect(withoutChip(field({}), { cuisine: "sushi" }, chip)).toEqual({});
		const payment = field({ key: "payment:", type: "multiCombo" });
		expect(
			withoutChip(
				payment,
				{ "payment:cash": "yes" },
				{ key: "payment:cash", value: "cash" },
			),
		).toEqual({ "payment:cash": undefined });
	});
});

describe("tagDiff", () => {
	it("is the patch turning some tags into others", () => {
		expect(
			tagDiff({ a: "1", b: "2", c: "3" }, { a: "1", b: "x", d: "4" }),
		).toEqual({ b: "x", c: undefined, d: "4" });
		expect(tagDiff({ a: "1" }, { a: "1" })).toEqual({});
	});
});
