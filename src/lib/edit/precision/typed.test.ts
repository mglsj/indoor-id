import { describe, expect, test } from "vitest";
import type { Loc } from "#lib/osm/entity.ts";
import { fromLocal, local } from "#lib/osm/geometry.ts";
import {
	EMPTY_INPUT,
	parseAngle,
	parseTyped,
	type TypedInput,
	typedCorner,
	typeKey,
} from "./typed.ts";

const O: Loc = [11.575, 48.137];
const at = (east: number, north: number) => fromLocal(O, [east, north]);
const metresFrom = (loc: Loc) =>
	local(O, loc).map((v) => Math.round(v * 1000) / 1000);
const north = { origin: O, angle: 0 };

describe("parseTyped", () => {
	test("a length in the setting's units", () => {
		expect(parseTyped("3.2", "metric")).toEqual({
			kind: "length",
			metres: 3.2,
		});
		expect(parseTyped("10", "imperial")).toEqual({
			kind: "length",
			metres: 3.048,
		});
	});

	test("width;depth and @dx,dy", () => {
		expect(parseTyped("4;3", "metric")).toEqual({ kind: "pair", x: 4, y: 3 });
		expect(parseTyped("@2,-1.5", "metric")).toEqual({
			kind: "pair",
			x: 2,
			y: -1.5,
		});
		expect(parseTyped("@2.5;1", "metric")).toEqual({
			kind: "pair",
			x: 2.5,
			y: 1,
		});
	});

	test("nothing while incomplete", () => {
		expect(parseTyped("4;", "metric")).toBeNull();
		expect(parseTyped("@", "metric")).toBeNull();
		expect(parseTyped("@3", "metric")).toBeNull();
		expect(parseTyped("", "metric")).toBeNull();
	});
});

describe("parseAngle", () => {
	test.each([
		["90", 90],
		["22.5°", 22.5],
		["-45", -45],
		["1,5", 1.5],
	] as const)("%s", (text, degrees) => {
		expect(parseAngle(text)).toBe(degrees);
	});
	test("not an angle", () => {
		expect(parseAngle("")).toBeNull();
		expect(parseAngle("x")).toBeNull();
	});
});

describe("typeKey", () => {
	const press = (input: TypedInput, ...keys: string[]) =>
		keys.reduce<TypedInput | null>(
			(i, key) =>
				i && typeKey(i, { key, ctrlKey: false, metaKey: false, altKey: false }),
			input,
		);

	test("digits start a length, unit letters follow", () => {
		expect(press(EMPTY_INPUT, "3", ".", "2", " ", "m")?.length).toBe("3.2 m");
		expect(press(EMPTY_INPUT, "1", "2", "'", "6", '"')?.length).toBe(`12'6"`);
	});

	test("a letter alone is a shortcut, not a value", () => {
		expect(press(EMPTY_INPUT, "m")).toBeNull();
		expect(press(EMPTY_INPUT, "s")).toBeNull();
	});

	test("Tab moves to the angle, Backspace edits and comes back", () => {
		const typed = press(EMPTY_INPUT, "3", "Tab", "9", "0");
		expect(typed).toEqual({ length: "3", angle: "90", field: "angle" });
		expect(
			press(typed as TypedInput, "Backspace", "Backspace", "Backspace"),
		).toEqual({
			length: "3",
			angle: "",
			field: "length",
		});
	});

	test("Backspace and Tab with nothing typed are not for the input", () => {
		expect(press(EMPTY_INPUT, "Backspace")).toBeNull();
		expect(press(EMPTY_INPUT, "Tab")).toBeNull();
	});

	test("keys with Ctrl are shortcuts", () => {
		expect(
			typeKey(EMPTY_INPUT, {
				key: "1",
				ctrlKey: true,
				metaKey: false,
				altKey: false,
			}),
		).toBeNull();
	});
});

describe("typedCorner", () => {
	test("a length along where the pointer points", () => {
		const loc = typedCorner({
			value: { kind: "length", metres: 3 },
			from: O,
			frame: north,
			toward: at(0, 10),
		});
		expect(metresFrom(loc)).toEqual([0, 3]);
	});

	test("an offset along a turned frame's axes", () => {
		const loc = typedCorner({
			value: { kind: "pair", x: 2, y: 0 },
			from: O,
			frame: { origin: O, angle: 90 },
			toward: O,
		});
		expect(metresFrom(loc)).toEqual([0, 2]);
	});

	test("a typed angle to the previous side, on the pointer's side", () => {
		const base = {
			value: { kind: "length", metres: 2 } as const,
			angle: 90,
			from: O,
			previous: at(-5, 0),
			frame: north,
		};
		expect(metresFrom(typedCorner({ ...base, toward: at(1, 4) }))).toEqual([
			0, 2,
		]);
		expect(metresFrom(typedCorner({ ...base, toward: at(1, -4) }))).toEqual([
			0, -2,
		]);
	});

	test("a typed angle for the first side is against the frame", () => {
		const loc = typedCorner({
			value: { kind: "length", metres: 2 },
			angle: 180,
			from: O,
			frame: north,
			toward: at(5, 5),
		});
		expect(metresFrom(loc)).toEqual([-2, 0]);
	});
});
