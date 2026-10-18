import { describe, expect, it } from "vitest";
import { keySuggestions, valueSuggestions } from "./tag-table.ts";

const found = (...values: string[]) =>
	values.map((value) => ({ value, title: value }));

describe("keySuggestions, as iD's raw tag editor offers keys", () => {
	it("leaves out keys set, discardable keys and numbered keys, and those not typed", () => {
		expect(
			keySuggestions(
				found("level", "level:ref", "created_by", "name_1", "indoor", "lev"),
				"lev",
				{ indoor: "room" },
				["created_by"],
			).map((s) => s.value),
		).toEqual(["level", "level:ref", "lev"]);
	});

	it("puts keys starting with what was typed first", () => {
		expect(
			keySuggestions(found("min_level", "level"), "level", {}, []).map(
				(s) => s.value,
			),
		).toEqual(["level", "min_level"]);
	});
});

describe("valueSuggestions", () => {
	it("keeps values with what was typed, those starting with it first", () => {
		expect(
			valueSuggestions(found("class_room", "room", "storage"), "room").map(
				(s) => s.value,
			),
		).toEqual(["room", "class_room"]);
	});
});
