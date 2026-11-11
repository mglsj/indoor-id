import { describe, expect, test } from "vitest";
import type { Loc } from "#lib/osm/entity.ts";
import { fromLocal, local } from "#lib/osm/geometry.ts";
import { drawnSpacing, gridLines, nearestCrossing } from "./grid.ts";

const O: Loc = [11.575, 48.137];
const at = (east: number, north: number) => fromLocal(O, [east, north]);
const metres = (loc: Loc) =>
	local(O, loc).map((v) => Math.round(v * 1000) / 1000 + 0);
const spacing = { minor: 0.5, major: 5 };

describe("drawnSpacing", () => {
	test("minor lines from 16 px a metre, major from 1.6, none below", () => {
		expect(drawnSpacing(spacing, 20)).toBe(0.5);
		expect(drawnSpacing(spacing, 10)).toBe(5);
		expect(drawnSpacing(spacing, 1)).toBeNull();
	});
});

describe("gridLines", () => {
	const view = [at(-0.2, -0.2), at(10.2, -0.2), at(10.2, 3.2), at(-0.2, 3.2)];

	test("every 5 m when minor lines would be too close", () => {
		const lines = gridLines({ origin: O, angle: 0 }, view, spacing, 10);
		// x = 0, 5, 10 and y = 0.
		expect(lines).toHaveLength(4);
		expect(lines.every((l) => l.major)).toBe(true);
		expect(metres(lines[1]?.from as Loc)[0]).toBe(5);
	});

	test("every 0.5 m, major every 5 m, when zoomed in", () => {
		const lines = gridLines({ origin: O, angle: 0 }, view, spacing, 40);
		// x = 0 to 10 (21 lines), y = 0 to 3 (7 lines).
		expect(lines).toHaveLength(28);
		expect(lines.filter((l) => l.major)).toHaveLength(4);
	});

	test("nothing when there would be too many", () => {
		expect(gridLines({ origin: O, angle: 0 }, view, spacing, 40, 20)).toEqual(
			[],
		);
	});
});

describe("nearestCrossing", () => {
	test("in a frame turned 90°", () => {
		// The frame's x axis is north: 1.2 m north, 0.7 m west is (1.2, 0.7) → (1, 0.5).
		const loc = nearestCrossing({ origin: O, angle: 90 }, at(-0.7, 1.2), 0.5);
		expect(metres(loc)).toEqual([-0.5, 1]);
	});
});
