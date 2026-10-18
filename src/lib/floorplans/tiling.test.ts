import { describe, expect, it } from "vitest";
import { type LngLat, place } from "./georef.ts";
import { distance, offset, RENNES } from "./test-geometry.ts";
import { pyramidLevel, tileCorners, tiles, visibleTiles } from "./tiling.ts";

describe("tiles", () => {
	it("keeps a plan that fits in one texture whole", () => {
		expect(tiles(1600, 1200)).toEqual([
			{ x: 0, y: 0, width: 1600, height: 1200 },
		]);
	});

	it("splits a large plan into tiles of at most 2048 px, row by row", () => {
		expect(tiles(5000, 3000)).toEqual([
			{ x: 0, y: 0, width: 2048, height: 2048 },
			{ x: 2048, y: 0, width: 2048, height: 2048 },
			{ x: 4096, y: 0, width: 904, height: 2048 },
			{ x: 0, y: 2048, width: 2048, height: 952 },
			{ x: 2048, y: 2048, width: 2048, height: 952 },
			{ x: 4096, y: 2048, width: 904, height: 952 },
		]);
	});
});

describe("tileCorners", () => {
	// 5000 × 3000 px at 5 cm per pixel, north up: 250 × 150 m.
	const transform = place(
		{ center: RENNES, metresPerPixel: 0.05, bearing: 0 },
		5000,
		3000,
	);
	const topLeft = offset(RENNES, -125, 75);

	it("places each tile where its pixels are on the plan", () => {
		const [, second] = tiles(5000, 3000);
		if (!second) throw new Error("No second tile");
		// The second tile starts 2048 px × 5 cm = 102.4 m right of the plan's left edge.
		const expected: LngLat[] = [
			offset(topLeft, 102.4, 0),
			offset(topLeft, 204.8, 0),
			offset(topLeft, 204.8, -102.4),
			offset(topLeft, 102.4, -102.4),
		];
		// Over 100 m, Mercator's scale drifts by ~1e-5 from the flat offsets above: allow 1 cm.
		tileCorners(transform, second).forEach((corner, i) => {
			expect(distance(corner, expected[i] as LngLat)).toBeLessThan(0.01);
		});
	});

	it("leaves no gap between neighbouring tiles", () => {
		const [first, second] = tiles(5000, 3000).map((tile) =>
			tileCorners(transform, tile),
		);
		expect(second?.[0]).toEqual(first?.[1]);
		expect(second?.[3]).toEqual(first?.[2]);
	});
});

describe("pyramidLevel", () => {
	// Level n is the image halved n times: it suits 2^n to 2^(n+1) image pixels per screen pixel.
	it("draws the smallest level with at least one pixel per screen pixel", () => {
		expect(pyramidLevel(1, 4)).toBe(0);
		expect(pyramidLevel(1.9, 4)).toBe(0);
		expect(pyramidLevel(2, 4)).toBe(1);
		expect(pyramidLevel(3.9, 4)).toBe(1);
		expect(pyramidLevel(4, 4)).toBe(2);
	});

	it("keeps to the levels there are", () => {
		expect(pyramidLevel(0.3, 4)).toBe(0);
		expect(pyramidLevel(1000, 4)).toBe(3);
		expect(pyramidLevel(Number.NaN, 4)).toBe(0);
	});

	it("keeps the level drawn until the zoom is a quarter step past its range", () => {
		// Level 1 suits 2^1 to 2^2; it stays from 2^0.75 to 2^2.25.
		expect(pyramidLevel(2 ** 2.2, 4, 1)).toBe(1);
		expect(pyramidLevel(2 ** 2.3, 4, 1)).toBe(2);
		expect(pyramidLevel(2 ** 0.8, 4, 1)).toBe(1);
		expect(pyramidLevel(2 ** 0.7, 4, 1)).toBe(0);
		// Far off: straight to the right level.
		expect(pyramidLevel(2 ** 3.5, 4, 1)).toBe(3);
	});
});

describe("tileCorners in plan units", () => {
	it("places a raster's pixels at `unit` plan units each", () => {
		const transform = place(
			{ center: RENNES, metresPerPixel: 0.05, bearing: 0 },
			5000,
			3000,
		);
		const tile = { x: 2048, y: 0, width: 2048, height: 2048 };
		// Half a plan unit per pixel: the tile covers plan units 1024 to 2048.
		expect(tileCorners(transform, tile, 0.5)).toEqual(
			tileCorners(transform, { x: 1024, y: 0, width: 1024, height: 1024 }),
		);
	});
});

describe("visibleTiles", () => {
	// 5000 × 3000 px at 5 cm per pixel, north up: 250 × 150 m, in tiles 102.4 m square.
	const transform = place(
		{ center: RENNES, metresPerPixel: 0.05, bearing: 0 },
		5000,
		3000,
	);
	const topLeft = offset(RENNES, -125, 75);
	const entries = tiles(5000, 3000).map((tile, i) => ({ tile, i }));
	/** The view from `east`, `south` metres off the plan's top left, `width` × `height` m. */
	const view = (east: number, south: number, width: number, height: number) => {
		const [west, north] = offset(topLeft, east, -south);
		const [eastEdge, southEdge] = offset(
			topLeft,
			east + width,
			-south - height,
		);
		return { west, south: southEdge, east: eastEdge, north };
	};
	const visible = (bounds: ReturnType<typeof view>, unit = 1) =>
		visibleTiles(entries, transform, unit, bounds).map((e) => e.i);

	it("gives the tiles the view covers", () => {
		expect(visible(view(10, 10, 50, 50))).toEqual([0]);
		// Across the corner where four tiles meet.
		expect(visible(view(90, 90, 30, 20))).toEqual([0, 1, 3, 4]);
		expect(visible(view(-100, -100, 600, 400))).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it("gives none when the view is off the plan", () => {
		expect(visible(view(300, 10, 50, 50))).toEqual([]);
		expect(visible(view(10, -80, 50, 50))).toEqual([]);
	});

	it("places tiles in pixels of `unit` plan units", () => {
		// Pixels of half a plan unit: the image covers the plan's top-left quarter, its
		// tiles 51.2 m square.
		expect(visible(view(130, 10, 50, 50), 0.5)).toEqual([]);
		expect(visible(view(10, 10, 30, 30), 0.5)).toEqual([0]);
		expect(visible(view(10, 10, 50, 30), 0.5)).toEqual([0, 1]);
	});
});
