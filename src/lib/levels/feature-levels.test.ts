import { describe, expect, it } from "vitest";
import { featureLevels } from "./feature-levels.ts";
import { formatLevels } from "./levels.ts";

/** Levels of a feature, written as a tag value to keep expectations readable. */
function levelsOf(...args: Parameters<typeof featureLevels>): string | null {
	const levels = featureLevels(...args);
	return levels && formatLevels(levels);
}

describe("featureLevels", () => {
	it("reads level=*", () => {
		expect(levelsOf({ level: "0-3" })).toBe("0-3");
	});

	it("reads repeat_on=*", () => {
		expect(levelsOf({ repeat_on: "1;3" })).toBe("1;3");
	});

	it("combines level=* and repeat_on=*", () => {
		expect(levelsOf({ level: "1", repeat_on: "2-5" })).toBe("1;2-5");
		expect(levelsOf({ level: "2;3;4", repeat_on: "4;5;1" })).toBe("1;2;3;4;5");
	});

	it("uses the readable one when level=* or repeat_on=* can't be read", () => {
		expect(levelsOf({ level: "G", repeat_on: "1;2" })).toBe("1;2");
		expect(levelsOf({ level: "1", repeat_on: "every floor" })).toBe("1");
	});

	it("returns null instead of guessing level 0 for an unreadable level", () => {
		expect(levelsOf({ level: "G", indoor: "room" })).toBeNull();
		expect(levelsOf({ level: "1,5" })).toBeNull();
	});

	it("reads min_level=* and max_level=* as a range", () => {
		expect(levelsOf({ min_level: "-1", max_level: "2" })).toBe("-1-2");
	});

	it("ignores min_level=* without max_level=*", () => {
		expect(levelsOf({ min_level: "-1" })).toBeNull();
	});

	describe("from building:levels=*", () => {
		it("counts levels from 0", () => {
			expect(levelsOf({ building: "yes", "building:levels": "3" })).toBe("0-2");
		});

		it("adds underground and roof levels", () => {
			expect(
				levelsOf({
					"building:levels": "5",
					"building:levels:underground": "3",
					"roof:levels": "1",
				}),
			).toBe("-3-5");
		});

		it("rounds partial levels up", () => {
			expect(levelsOf({ "building:levels": "2.5" })).toBe("0-2");
		});

		it("has no level for building:levels=0 (OsmInEdit invented level -1)", () => {
			expect(levelsOf({ "building:levels": "0" })).toBeNull();
		});

		it("can be underground only", () => {
			expect(
				levelsOf({
					"building:levels": "0",
					"building:levels:underground": "2",
				}),
			).toBe("-2--1");
		});

		it("ignores a value that is not a number", () => {
			expect(levelsOf({ "building:levels": "many" })).toBeNull();
		});
	});

	it("prefers level=* over building:levels=*", () => {
		expect(levelsOf({ level: "1", "building:levels": "3" })).toBe("1");
	});

	describe("from parent relations", () => {
		it("reads the level of type=level relations", () => {
			expect(
				levelsOf({ indoor: "room" }, [
					{ type: "level", level: "1" },
					{ type: "level", level: "2" },
				]),
			).toBe("1;2");
		});

		it("reads the level of multipolygons", () => {
			expect(
				levelsOf({}, [{ type: "multipolygon", level: "0;1", indoor: "room" }]),
			).toBe("0;1");
		});

		it("ignores other relations and unreadable levels without failing", () => {
			expect(
				levelsOf({}, [
					{ type: "route", level: "3" },
					{ type: "level", level: "ground floor" },
					{ type: "level", level: "-1" },
				]),
			).toBe("-1");
		});

		it("is overridden by the feature's own level=*", () => {
			expect(levelsOf({ level: "4" }, [{ type: "level", level: "1" }])).toBe(
				"4",
			);
		});
	});

	it("returns null when nothing tells the level", () => {
		expect(levelsOf({ amenity: "bench" })).toBeNull();
		expect(levelsOf({})).toBeNull();
	});
});
