import { describe, expect, test } from "vitest";
import type { Loc } from "#lib/osm/entity.ts";
import { fromLocal, local, toMercator } from "#lib/osm/geometry.ts";
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

/** Ground metres from `p` to the straight line `a`–`b` as the map draws it (Web Mercator). */
function offDrawnLine(p: Loc, [a, b]: readonly [Loc, Loc]): number {
	const [px, py] = toMercator(p);
	const [ax, ay] = toMercator(a);
	const [bx, by] = toMercator(b);
	// Web Mercator's sphere to the mean radius `local` measures on.
	const scale = (Math.cos((p[1] * Math.PI) / 180) * 6_371_008.8) / 6378137;
	return (
		(Math.abs((px - ax) * (by - ay) - (py - ay) * (bx - ax)) /
			Math.hypot(bx - ax, by - ay)) *
		scale
	);
}

describe("an angled guide as drawn", () => {
	// Far from the equator, where a line straight in longitude and latitude bends most away
	// from the straight line Web Mercator draws: it was 15 cm at 52.5°N, 2 km either way.
	const origin: Loc = [13.4, 52.5];

	test.each([30, 45, 60, 135])(
		"at %i° passes through its origin and every point of it",
		(angle) => {
			const ends = guideEnds({ origin, angle }, 2000);
			expect(offDrawnLine(origin, ends)).toBeLessThan(0.001);
			const rad = (angle * Math.PI) / 180;
			for (const t of [-700, -12.5, 3, 40, 1500]) {
				const p = fromLocal(origin, [t * Math.cos(rad), t * Math.sin(rad)]);
				expect(offDrawnLine(p, ends)).toBeLessThan(0.001);
			}
		},
	);

	test("is drawn on the same line while placed (500 m) as once placed (2 km)", () => {
		const preview = guideEnds({ origin, angle: 45 }, 500);
		const placed = guideEnds({ origin, angle: 45 }, 2000);
		expect(offDrawnLine(preview[0], placed)).toBeLessThan(0.001);
		expect(offDrawnLine(preview[1], placed)).toBeLessThan(0.001);
	});

	test("a parallel guide 3 m away is 3 m away as drawn", () => {
		const a = fromLocal(origin, [0, 0]);
		const b = fromLocal(origin, [Math.cos(0.5), Math.sin(0.5)]);
		const parallel = parallelAt(a, b, 3, fromLocal(origin, [-5, 5]));
		const ends = guideEnds(parallel, 2000);
		expect(offDrawnLine(origin, ends)).toBeCloseTo(3, 3);
		expect(
			offDrawnLine(
				fromLocal(origin, [400 * Math.cos(0.5), 400 * Math.sin(0.5)]),
				ends,
			),
		).toBeCloseTo(3, 3);
	});
});
