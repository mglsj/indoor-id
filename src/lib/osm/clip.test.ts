import { describe, expect, it } from "vitest";
import { clipPolygons } from "./clip.ts";
import type { Loc } from "./entity.ts";

const square = (x0: number, y0: number, x1: number, y1: number): Loc[] => [
	[x0, y0],
	[x1, y0],
	[x1, y1],
	[x0, y1],
	[x0, y0],
];
/** A ring's corners from its lowest-left one, ignoring where it starts and its closing point. */
const corners = (ring: readonly Loc[]) => {
	const open = ring.slice(0, -1);
	const start = open.reduce((best, p, i) => {
		const b = open[best] as Loc;
		return p[0] < b[0] || (p[0] === b[0] && p[1] < b[1]) ? i : best;
	}, 0);
	return [...open.slice(start), ...open.slice(0, start)];
};

describe("clipPolygons", () => {
	it("cuts a room out of a level outline, keeping the outline's own corners exactly", () => {
		const outline = square(2.3500001, 48.85, 2.3510001, 48.851);
		const room = square(2.3500001, 48.85, 2.3505001, 48.851);
		const pieces = clipPolygons("difference", [[outline]], [[room]], 1e9);
		expect(pieces).toHaveLength(1);
		const [ring] = pieces[0] ?? [];
		// Closed, counter-clockwise, through the outline's corners as given.
		expect(ring?.[0]).toEqual(ring?.at(-1));
		expect(corners(ring ?? [])).toEqual([
			[2.3505001, 48.85],
			[2.3510001, 48.85],
			[2.3510001, 48.851],
			[2.3505001, 48.851],
		]);
	});

	it("leaves a room standing alone as a hole, and removes rooms that overlap each other", () => {
		const outline = square(0, 0, 10, 10);
		const a = square(2, 2, 5, 5);
		const b = square(4, 4, 6, 6);
		const pieces = clipPolygons("difference", [[outline]], [[a], [b]], 1000);
		expect(pieces).toHaveLength(1);
		expect(pieces[0]).toHaveLength(2);
		expect(corners(pieces[0]?.[1] ?? [])).toHaveLength(8);
	});

	it("gives a hole's island as a polygon of its own", () => {
		const outline = square(0, 0, 10, 10);
		const ring = [square(2, 2, 8, 8), square(4, 4, 6, 6).reverse()];
		const pieces = clipPolygons("difference", [[outline]], [ring], 1000);
		expect(pieces).toHaveLength(2);
		expect(pieces.map((p) => p.length).sort()).toEqual([1, 2]);
	});

	it("intersects two overlapping buildings", () => {
		const pieces = clipPolygons(
			"intersection",
			[[square(0, 0, 10, 10)]],
			[[square(8, 0, 20, 10)]],
			1000,
		);
		expect(pieces.map((p) => p.map(corners))).toEqual([
			[
				[
					[8, 0],
					[10, 0],
					[10, 10],
					[8, 10],
				],
			],
		]);
	});
});
