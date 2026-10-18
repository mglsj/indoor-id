import { describe, expect, it } from "vitest";
import {
	addChips,
	chipsOf,
	comboSuggestions,
	displayValue,
	fuzzyMatch,
	moveChip,
	removeChip,
	tagValue,
	toggleChip,
} from "./combo.ts";
import type { Field } from "./presets.ts";

const field = (extra: Partial<Field>): Field => ({
	id: "f",
	key: "f",
	type: "combo",
	label: "F",
	options: [],
	terms: [],
	universal: false,
	snakeCase: true,
	caseSensitive: false,
	customValues: true,
	autoSuggestions: true,
	allowDuplicates: false,
	...extra,
});

const internet = field({
	key: "internet_access",
	options: [
		{ value: "yes", label: "Yes" },
		{ value: "wlan", label: "Wifi" },
	],
	customValues: false,
});
const room = field({ key: "room" });
const shop = field({
	key: "shop",
	type: "typeCombo",
	options: [{ value: "bakery", label: "Bakery", description: "Bread" }],
});

describe("tagValue: what is typed, as a tag value (iD's combo)", () => {
	it("is the option's key for its label", () => {
		expect(tagValue(internet, "Wifi")).toBe("wlan");
		expect(tagValue(internet, "wifi")).toBe("wlan");
	});

	it("is snake_case and lowercase otherwise", () => {
		expect(tagValue(room, "Class Room")).toBe("class_room");
		expect(tagValue(room, "  ")).toBeUndefined();
	});

	it("keeps spaces and capitals when the field says so", () => {
		expect(
			tagValue(field({ snakeCase: false, caseSensitive: true }), "Mo-Fr 08:00"),
		).toBe("Mo-Fr 08:00");
	});

	it("is yes for an empty type", () => {
		expect(tagValue(shop, "")).toBe("yes");
	});
});

describe("displayValue: a tag value as shown", () => {
	it("is the option's label, or the value", () => {
		expect(displayValue(internet, "wlan")).toBe("Wifi");
		expect(displayValue(room, "class_room")).toBe("class_room");
		expect(displayValue(room, undefined)).toBe("");
	});

	it("is empty for a type of yes", () => {
		expect(displayValue(shop, "yes")).toBe("");
	});
});

describe("fuzzyMatch, as iD's combobox", () => {
	it("allows a typo every 5 letters, anywhere in the text", () => {
		expect(fuzzyMatch("bakry", "bakery")).toBe(true);
		expect(fuzzyMatch("baker", "the bakery")).toBe(true);
		expect(fuzzyMatch("bkry", "bakery")).toBe(false);
	});
});

describe("comboSuggestions", () => {
	const taginfo = (...values: string[]) =>
		values.map((value) => ({ value, title: value }));

	it("lists the options, then the values taginfo knows", () => {
		expect(
			comboSuggestions(shop, "", taginfo("bakery", "kiosk"), {}).map((s) => [
				s.value,
				s.label,
			]),
		).toEqual([
			["bakery", "Bakery"],
			["kiosk", "kiosk"],
		]);
	});

	it("keeps an option's description, and marks values without a label as raw", () => {
		const [bakery, kiosk] = comboSuggestions(
			shop,
			"",
			taginfo("bakery", "kiosk"),
			{},
		);
		expect(bakery).toMatchObject({ description: "Bread", raw: false });
		expect(kiosk).toMatchObject({ raw: true });
	});

	it("leaves out misspelled and deprecated values, and a type's yes", () => {
		expect(
			comboSuggestions(
				shop,
				"",
				taginfo("yes", "Kiosk", "car repair", "convenience", "kiosk"),
				{ deprecated: ["convenience"] },
			).map((s) => s.value),
		).toEqual(["bakery", "kiosk"]);
	});

	it("filters by the text typed, in the label or the value, with typos", () => {
		const values = (query: string) =>
			comboSuggestions(internet, query, null, {}).map((s) => s.value);
		expect(values("wi")).toEqual(["wlan"]);
		expect(values("wla")).toEqual(["wlan"]);
		expect(values("wfi")).toEqual([]);
		expect(
			comboSuggestions(shop, "bakry", null, {}).map((s) => s.value),
		).toEqual(["bakery"]);
	});

	it("leaves out the values already chosen, unless duplicates are allowed", () => {
		expect(
			comboSuggestions(shop, "", taginfo("kiosk"), { chosen: ["bakery"] }).map(
				(s) => s.value,
			),
		).toEqual(["kiosk"]);
	});
});

const cuisine = field({
	key: "cuisine",
	type: "semiCombo",
	options: [
		{ value: "pizza", label: "Pizza" },
		{ value: "italian", label: "Italian" },
	],
});
const payment = field({
	key: "payment:",
	type: "multiCombo",
	options: [
		{ value: "cash", label: "Cash" },
		{ value: "cards", label: "Payment Card" },
	],
});
const gender = field({
	key: undefined,
	keys: ["male", "female", "unisex"],
	type: "manyCombo",
	options: [
		{ value: "male", label: "Male" },
		{ value: "female", label: "Female" },
		{ value: "unisex", label: "Unisex" },
	],
});

describe("chips of a semiCombo (a ; list)", () => {
	it("are the values of the list, each once", () => {
		expect(
			chipsOf(cuisine, { cuisine: "pizza; kebab;pizza" }).map((c) => [
				c.value,
				c.label,
			]),
		).toEqual([
			["pizza", "Pizza"],
			["kebab", "kebab"],
		]);
	});

	it("adds what is typed at the end, split at ; or commas", () => {
		expect(addChips(cuisine, { cuisine: "pizza" }, "Italian")).toEqual({
			cuisine: "pizza;italian",
		});
		expect(addChips(cuisine, {}, "Thai Food, pizza;pizza")).toEqual({
			cuisine: "thai_food;pizza",
		});
		expect(addChips(cuisine, { cuisine: "pizza" }, "  ")).toEqual({});
	});

	it("keeps a value twice only when the field allows it", () => {
		expect(addChips(cuisine, { cuisine: "pizza" }, "pizza")).toEqual({
			cuisine: "pizza",
		});
		const stops = field({ ...cuisine, key: "via", allowDuplicates: true });
		expect(addChips(stops, { via: "a" }, "a")).toEqual({ via: "a;a" });
	});

	it("removes one, and the tag with the last", () => {
		expect(removeChip(cuisine, { cuisine: "pizza;italian" }, 0)).toEqual({
			cuisine: "italian",
		});
		expect(removeChip(cuisine, { cuisine: "pizza" }, 0)).toEqual({
			cuisine: undefined,
		});
	});

	it("moves one to another place", () => {
		expect(moveChip(cuisine, { cuisine: "pizza;italian;thai" }, 2, 0)).toEqual({
			cuisine: "thai;pizza;italian",
		});
		expect(moveChip(cuisine, { cuisine: "pizza;italian;thai" }, 0, 1)).toEqual({
			cuisine: "italian;pizza;thai",
		});
	});
});

describe("chips of a multiCombo (key:value=yes)", () => {
	const tags = {
		"payment:cash": "yes",
		"payment:cards": "no",
		amenity: "cafe",
	};

	it("are the keys under its prefix, with their state", () => {
		expect(chipsOf(payment, tags)).toEqual([
			{
				key: "payment:cash",
				value: "cash",
				label: "Cash",
				state: "yes",
				raw: false,
			},
			{
				key: "payment:cards",
				value: "cards",
				label: "Payment Card",
				state: "no",
				raw: false,
			},
		]);
	});

	it("adds a key set to yes, but never over a value other than no", () => {
		expect(addChips(payment, tags, "Coins")).toEqual({
			"payment:coins": "yes",
		});
		expect(addChips(payment, tags, "Payment Card")).toEqual({
			"payment:cards": "yes",
		});
		expect(addChips(payment, tags, "cash")).toEqual({});
	});

	it("toggles yes and no, and removes the key", () => {
		expect(toggleChip(tags, "payment:cash")).toEqual({ "payment:cash": "no" });
		expect(toggleChip(tags, "payment:cards")).toEqual({
			"payment:cards": "yes",
		});
		expect(removeChip(payment, tags, 1)).toEqual({
			"payment:cards": undefined,
		});
	});
});

describe("chips of a manyCombo (one of its keys=yes)", () => {
	it("are its keys that are set", () => {
		expect(
			chipsOf(gender, { female: "yes", male: "no", name: "WC" }).map((c) => [
				c.key,
				c.state,
			]),
		).toEqual([
			// In the tags' order, as iD.
			["female", "yes"],
			["male", "no"],
		]);
	});

	it("adds one of its keys by label", () => {
		expect(addChips(gender, {}, "Unisex")).toEqual({ unisex: "yes" });
	});
});
