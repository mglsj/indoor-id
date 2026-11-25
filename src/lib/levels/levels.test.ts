import { describe, expect, it } from "vitest";
import {
	formatLevels,
	isOnLevel,
	levelToShow,
	listLevels,
	MAX_LEVEL_SPAN,
	parseLevels,
	wholeLevels,
} from "./levels.ts";

const single = (level: number) => ({ min: level, max: level });

describe("parseLevels", () => {
	it.each([
		["0", [single(0)]],
		["-1", [single(-1)]],
		["2", [single(2)]],
		["0.5", [single(0.5)]],
		["-0.5", [single(-0.5)]],
	])("reads the single level %j", (value, expected) => {
		expect(parseLevels(value)).toEqual(expected);
	});

	it("reads a list of levels, sorted", () => {
		expect(parseLevels("2;0;1")).toEqual([single(0), single(1), single(2)]);
	});

	it("keeps listed levels distinct: 0;1 does not include a 0.5 mezzanine", () => {
		expect(parseLevels("0;1")).toEqual([single(0), single(1)]);
	});

	it.each([
		["0-2", [{ min: 0, max: 2 }]],
		["-2--1", [{ min: -2, max: -1 }]],
		["-1-3", [{ min: -1, max: 3 }]],
		["0.5-1.5", [{ min: 0.5, max: 1.5 }]],
		["3-1", [{ min: 1, max: 3 }]],
	])("reads the range %j", (value, expected) => {
		expect(parseLevels(value)).toEqual(expected);
	});

	it("reads lists mixing levels and ranges", () => {
		expect(parseLevels("-1;2-3")).toEqual([single(-1), { min: 2, max: 3 }]);
	});

	it("merges duplicates and overlapping ranges", () => {
		expect(parseLevels("1;0-2;1;5")).toEqual([{ min: 0, max: 2 }, single(5)]);
	});

	it("tolerates spaces around values", () => {
		expect(parseLevels(" 1 ; 2 ")).toEqual([single(1), single(2)]);
	});

	it.each([
		[""],
		[" "],
		["G"],
		["ground"],
		["1;"],
		[";1"],
		["1;;2"],
		["1-"],
		["1--"],
		["0-1-2"],
		["1.2.3"],
		// A comma is ambiguous (list or decimal comma): don't guess, validation will flag it.
		["1,5"],
		["0,1"],
	])("rejects %j", (value) => {
		expect(parseLevels(value)).toBeNull();
	});
});

describe("formatLevels", () => {
	it.each([
		[[single(0)], "0"],
		[[single(-1)], "-1"],
		[[single(0.5)], "0.5"],
		[[single(0), single(1), single(2)], "0;1;2"],
		[[{ min: 0, max: 2 }], "0-2"],
		[[{ min: -2, max: -1 }], "-2--1"],
		[[{ min: 0.5, max: 1.5 }], "0.5-1.5"],
		[[single(-1), { min: 2, max: 3 }], "-1;2-3"],
	])("writes %j as %j", (levels, expected) => {
		expect(formatLevels(levels)).toBe(expected);
	});

	it.each([["0"], ["-1;0;1"], ["0-2"], ["-2--1"], ["0.5-1.5"], ["-1;0.5;2-4"]])(
		"round-trips %j",
		(value) => {
			const levels = parseLevels(value);
			expect(levels).not.toBeNull();
			expect(formatLevels(levels ?? [])).toBe(value);
		},
	);
});

describe("isOnLevel", () => {
	const levels = parseLevels("-1;0-2") ?? [];

	it("is true for listed levels and anything inside a range", () => {
		expect(isOnLevel(levels, -1)).toBe(true);
		expect(isOnLevel(levels, 0)).toBe(true);
		expect(isOnLevel(levels, 0.5)).toBe(true);
		expect(isOnLevel(levels, 2)).toBe(true);
	});

	it("is false between listed levels and outside ranges", () => {
		expect(isOnLevel(levels, -0.5)).toBe(false);
		expect(isOnLevel(levels, 3)).toBe(false);
		expect(isOnLevel(levels, -2)).toBe(false);
	});
});

describe("levelToShow", () => {
	it("goes to the level of a plan on one level", () => {
		expect(levelToShow("0", 2)).toBe(0);
		expect(levelToShow("-1", 0)).toBe(-1);
		expect(levelToShow("0.5", 3)).toBe(0.5);
	});

	it("stays when the plan is on every level, or on one that can't be read", () => {
		expect(levelToShow(null, 2)).toBe(2);
		expect(levelToShow("G", 2)).toBe(2);
	});

	it("stays when the level shown is one of the plan's, else goes to the lowest", () => {
		expect(levelToShow("0;1", 1)).toBe(1);
		expect(levelToShow("0;1", 3)).toBe(0);
		expect(levelToShow("0-2", 1)).toBe(1);
		expect(levelToShow("0-2", 5)).toBe(0);
		expect(levelToShow("1;-1", 3)).toBe(-1);
	});
});

describe("listLevels", () => {
	it("lists ranges of whole levels", () => {
		expect(listLevels("-1;1-3")).toEqual([-1, 1, 2, 3]);
	});

	it("gives up on a range too wide to be a building's (a stray level=0-10000000)", () => {
		expect(listLevels("0-10000000")).toBeNull();
		expect(listLevels(`0-${MAX_LEVEL_SPAN + 1}`)).toBeNull();
		expect(listLevels(`0-${MAX_LEVEL_SPAN}`)).toHaveLength(MAX_LEVEL_SPAN + 1);
	});
});

describe("wholeLevels", () => {
	it("gives a range's ends and the whole levels between them", () => {
		expect(wholeLevels({ min: -0.5, max: 2 })).toEqual([-0.5, 0, 1, 2]);
		expect(wholeLevels({ min: 0.5, max: 0.5 })).toEqual([0.5]);
	});

	it("gives only the ends of a range too wide to be a building's", () => {
		expect(wholeLevels({ min: 0, max: 10_000_000 })).toEqual([0, 10_000_000]);
	});
});
