import { describe, expect, test } from "vitest";
import {
	defaultUnits,
	formatAngle,
	formatArea,
	formatLength,
	parseLength,
} from "./length.ts";

describe("parseLength", () => {
	test.each([
		["3.2", "metric", 3.2],
		["3,2", "metric", 3.2],
		["3.2 m", "imperial", 3.2],
		["320 cm", "metric", 3.2],
		["320cm", "metric", 3.2],
		["1500 mm", "metric", 1.5],
		["12'6\"", "metric", 3.81],
		["12' 6\"", "metric", 3.81],
		["12 ft 6 in", "metric", 3.81],
		["12'6", "metric", 3.81],
		["10", "imperial", 3.048],
		["3.8 ft", "metric", 1.15824],
		['6 1/2"', "metric", 0.1651],
		["-2.4", "metric", -2.4],
		[".5", "metric", 0.5],
	] as const)("%s (%s) is %f m", (text, units, metres) => {
		expect(parseLength(text, units)).toBeCloseTo(metres, 6);
	});

	test.each(["", "abc", "3 m 4", "3..2", "-", "1/0", "3 xyz"])(
		"%j is not a length",
		(text) => {
			expect(parseLength(text, "metric")).toBeNull();
		},
	);
});

describe("formatLength", () => {
	test("metric to the centimetre", () => {
		expect(formatLength(3.4249, "metric")).toBe("3.42 m");
		expect(formatLength(0.005, "metric")).toBe("0.01 m");
		expect(formatLength(12, "metric")).toBe("12.00 m");
	});

	test("imperial to the quarter inch", () => {
		expect(formatLength(3.81, "imperial")).toBe("12' 6\"");
		// 3.4 m = 133.858 in = 11' 1.858", nearest quarter 1¾.
		expect(formatLength(3.4, "imperial")).toBe("11' 1¾\"");
		expect(formatLength(0.1651, "imperial")).toBe('6½"');
	});
});

describe("formatArea and formatAngle", () => {
	test("areas", () => {
		expect(formatArea(12.345, "metric")).toBe("12.35 m²");
		expect(formatArea(250.4, "metric")).toBe("250 m²");
		expect(formatArea(5, "imperial")).toBe("53.8 ft²");
		expect(formatArea(10, "imperial")).toBe("108 ft²");
	});

	test("angles to a tenth of a degree", () => {
		expect(formatAngle(90)).toBe("90°");
		expect(formatAngle(22.4999)).toBe("22.5°");
		expect(formatAngle(-0.01)).toBe("0°");
	});
});

describe("defaultUnits", () => {
	test.each([
		["en-US", "imperial"],
		["en", "imperial"],
		["en-GB", "metric"],
		["de", "metric"],
		["my", "imperial"],
		["not a locale!", "metric"],
	] as const)("%s → %s", (locale, units) => {
		expect(defaultUnits(locale)).toBe(units);
	});
});
