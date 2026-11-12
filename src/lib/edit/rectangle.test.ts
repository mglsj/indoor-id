import { describe, expect, test } from "vitest";
import type { Loc } from "#lib/osm/entity.ts";
import { fromLocal, local } from "#lib/osm/geometry.ts";
import { frameRectangle, sideRectangle, typedRectangle } from "./rectangle.ts";

const O: Loc = [11.575, 48.137];
const at = (east: number, north: number) => fromLocal(O, [east, north]);
const metres = (corners: Loc[] | null) =>
	corners?.map((c) => local(O, c).map((v) => Math.round(v * 1000) / 1000));

describe("frameRectangle", () => {
	test("in a north frame, from the corner clicked first", () => {
		expect(
			metres(frameRectangle({ origin: O, angle: 0 }, O, at(4, -3))),
		).toEqual([
			[0, 0],
			[4, 0],
			[4, -3],
			[0, -3],
		]);
	});

	test("in a frame turned 90°, the pointer's x is north", () => {
		expect(
			metres(frameRectangle({ origin: O, angle: 90 }, O, at(-3, 4))),
		).toEqual([
			[0, 0],
			[0, 4],
			[-3, 4],
			[-3, 0],
		]);
	});

	test("nothing on a line", () => {
		expect(frameRectangle({ origin: O, angle: 0 }, O, at(4, 0))).toBeNull();
	});
});

describe("typedRectangle", () => {
	test("4;3 towards the south-west", () => {
		expect(
			metres(typedRectangle({ origin: O, angle: 0 }, O, 4, 3, at(-1, -1))),
		).toEqual([
			[0, 0],
			[-4, 0],
			[-4, -3],
			[0, -3],
		]);
	});
});

describe("sideRectangle", () => {
	test("on a side going north-east, as wide as the third click is off it", () => {
		const b = at(3, 3);
		const corners = metres(sideRectangle(O, b, at(-1, 1)));
		expect(corners?.[2]).toEqual([2, 4]);
		expect(corners?.[3]).toEqual([-1, 1]);
	});

	test("a typed width, on the pointer's side", () => {
		const corners = metres(sideRectangle(O, at(4, 0), at(1, -10), 2));
		expect(corners?.[3]).toEqual([0, -2]);
	});
});
