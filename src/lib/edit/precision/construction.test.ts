import { describe, expect, test } from "vitest";
import type { Loc } from "#lib/osm/entity.ts";
import { fromLocal, local } from "#lib/osm/geometry.ts";
import { guideEnds, offsetFrom, parallelAt } from "./construction.ts";

const O: Loc = [11.575, 48.137];
const at = (east: number, north: number) => fromLocal(O, [east, north]);
const metres = (loc: Loc) =>
	local(O, loc).map((v) => Math.round(v * 1000) / 1000);

describe("parallelAt", () => {
	test("a guide 2.4 m from a side, on the side of the pointer", () => {
		const above = parallelAt(at(0, 0), at(10, 0), 2.4, at(3, 7));
		expect(metres(above.origin)).toEqual([0, 2.4]);
		expect(above.angle).toBeCloseTo(0, 6);
		const below = parallelAt(at(0, 0), at(10, 0), 2.4, at(3, -1));
		expect(metres(below.origin)).toEqual([0, -2.4]);
	});

	test("along a turned side", () => {
		const guide = parallelAt(at(0, 0), at(3, 4), 5, at(-10, 10));
		// Square to the side (3, 4) on the left is (-4, 3).
		expect(metres(guide.origin)).toEqual([-4, 3]);
		expect(guide.angle).toBeCloseTo(53.13, 2);
	});
});

describe("offsetFrom", () => {
	test("the distance of a point from a side's line, beyond its ends too", () => {
		expect(offsetFrom(at(0, 0), at(10, 0), at(25, -3))).toBeCloseTo(3, 6);
	});
});

describe("guideEnds", () => {
	test("a guide drawn as a segment a given length either side of its origin", () => {
		const [a, b] = guideEnds({ origin: O, angle: 90 }, 500);
		expect(metres(a)).toEqual([0, -500]);
		expect(metres(b)).toEqual([0, 500]);
	});
});
