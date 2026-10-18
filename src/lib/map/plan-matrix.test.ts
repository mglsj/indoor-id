import { describe, expect, it } from "vitest";
import { fitPlan, type LngLat, place } from "#lib/floorplans/georef.ts";
import { offset, RENNES } from "#lib/floorplans/test-geometry.ts";
import { planToClip, unitPixels } from "./plan-matrix.ts";

/**
 * World pixels of a position, MapLibre's way: the world is `size` pixels square, x east from
 * 180° W, y south from the top of Web Mercator (the textbook formula, not the module's).
 */
function worldPixel([lon, lat]: LngLat, size: number): [number, number] {
	const phi = (lat * Math.PI) / 180;
	return [
		((lon + 180) / 360) * size,
		((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * size,
	];
}

/**
 * A straight-down camera on a `width` × `height` px view centred on `centre`: world pixels to
 * clip space, column-major as MapLibre gives it (x right, y up in clip space).
 */
function camera(centre: [number, number], width: number, height: number) {
	const [cx, cy] = centre;
	// clip.x = (x − cx)·2/width, clip.y = −(y − cy)·2/height.
	return [
		2 / width,
		0,
		0,
		0,
		0,
		-2 / height,
		0,
		0,
		0,
		0,
		1,
		0,
		(-cx * 2) / width,
		(cy * 2) / height,
		0,
		1,
	];
}

/** Clip space x and y (divided by w) of plan units through a column-major matrix. */
function apply(
	m: ArrayLike<number>,
	[u, v]: [number, number],
): [number, number] {
	const at = (i: number) => m[i] ?? 0;
	const x = at(0) * u + at(4) * v + at(12);
	const y = at(1) * u + at(5) * v + at(13);
	const w = at(3) * u + at(7) * v + at(15);
	return [x / w, y / w];
}

/** At zoom 20 the world is 512 × 2^20 pixels: about 5 cm a pixel at Rennes. */
const SIZE = 512 * 2 ** 20;
const VIEW = { width: 800, height: 600 };

describe("planToClip: plan units to clip space, composed in float64", () => {
	const plan = place(
		{ center: RENNES, metresPerPixel: 0.05, bearing: 30 },
		400,
		300,
	);
	const view = camera(worldPixel(RENNES, SIZE), VIEW.width, VIEW.height);
	const m = planToClip(plan, view, SIZE);

	it("puts the plan's centre where the camera looks", () => {
		const [x, y] = apply(m, [200, 150]);
		expect(x).toBeCloseTo(0, 6);
		expect(y).toBeCloseTo(0, 6);
	});

	it("puts every plan unit where the world pixel of its position is", () => {
		// The plan's top-left corner: 10 m and 7.5 m from the centre, turned by 30°.
		const rad = (30 * Math.PI) / 180;
		const corner = offset(
			RENNES,
			-10 * Math.cos(rad) + 7.5 * Math.sin(rad),
			7.5 * Math.cos(rad) + 10 * Math.sin(rad),
		);
		const [px, py] = worldPixel(corner, SIZE);
		const [cx, cy] = worldPixel(RENNES, SIZE);
		const [x, y] = apply(m, [0, 0]);
		// To the nearest 1/100 px.
		expect(((x * VIEW.width) / 2 - (px - cx)) ** 2).toBeLessThan(1e-4);
		expect(((-y * VIEW.height) / 2 - (py - cy)) ** 2).toBeLessThan(1e-4);
	});

	it("keeps a perspective plan's corners on their positions", () => {
		const corners: LngLat[] = [
			offset(RENNES, -10, 8),
			offset(RENNES, 9, 7),
			offset(RENNES, 12, -8),
			offset(RENNES, -11, -6),
		];
		const pixels: [number, number][] = [
			[0, 0],
			[400, 0],
			[400, 300],
			[0, 300],
		];
		const warped = fitPlan(
			pixels.map((image, i) => ({ image, map: corners[i] as LngLat })),
			"projective",
		).transform;
		const mw = planToClip(warped, view, SIZE);
		const [cx, cy] = worldPixel(RENNES, SIZE);
		pixels.forEach((pixel, i) => {
			const [px, py] = worldPixel(corners[i] as LngLat, SIZE);
			const [x, y] = apply(mw, pixel);
			expect(((x * VIEW.width) / 2 - (px - cx)) ** 2).toBeLessThan(1e-4);
			expect(((-y * VIEW.height) / 2 - (py - cy)) ** 2).toBeLessThan(1e-4);
		});
	});

	it("stays exact far from the world's origin, where float32 would jitter", () => {
		// Float32 world pixels at zoom 20 are 32 px apart around Rennes.
		const nudged = planToClip(
			place(
				{ center: offset(RENNES, 0.01, 0), metresPerPixel: 0.05, bearing: 30 },
				400,
				300,
			),
			view,
			SIZE,
		);
		const [a] = apply(Float32Array.from(m), [200, 150]);
		const [b] = apply(Float32Array.from(nudged), [200, 150]);
		// 1 cm east, in pixels of the ground size a world pixel has at Rennes.
		const metresPerPixel =
			(2 * Math.PI * 6378137 * Math.cos((RENNES[1] * Math.PI) / 180)) / SIZE;
		expect(((b - a) * VIEW.width) / 2).toBeCloseTo(0.01 / metresPerPixel, 2);
	});
});

describe("unitPixels: device pixels a plan unit spans", () => {
	it("measures the plan's scale on screen at a spot", () => {
		const plan = place(
			{ center: RENNES, metresPerPixel: 0.05, bearing: 30 },
			400,
			300,
		);
		const m = planToClip(
			plan,
			camera(worldPixel(RENNES, SIZE), 800, 600),
			SIZE,
		);
		// Ground metres a world pixel spans at Rennes' latitude.
		const metresPerPixel =
			(2 * Math.PI * 6378137 * Math.cos((RENNES[1] * Math.PI) / 180)) / SIZE;
		expect(unitPixels(m, VIEW, [200, 150])).toBeCloseTo(
			0.05 / metresPerPixel,
			3,
		);
		// Twice the device pixels on a screen of twice the density.
		expect(
			unitPixels(m, { width: 1600, height: 1200 }, [200, 150]),
		).toBeCloseTo((2 * 0.05) / metresPerPixel, 3);
	});
});
