import { describe, expect, it } from "vitest";
import {
	type ControlPoint,
	corners,
	dragCorner,
	dragRotation,
	fitPlan,
	GeorefError,
	type LngLat,
	moveTo,
	offsetBy,
	type Pixel,
	place,
	positionOf,
	project,
	rotateAbout,
	scaleToDistance,
	type Transform,
	translateTo,
	unproject,
} from "./georef.ts";
import { distance, northUpPlan, offset, RENNES } from "./test-geometry.ts";

describe("fit: similarity", () => {
	it("places the whole plan from two control points", () => {
		const truth = northUpPlan(RENNES);
		const points: ControlPoint[] = [
			{ image: [0, 0], map: truth(0, 0) },
			{ image: [400, 300], map: truth(400, 300) },
		];
		const { transform } = fitPlan(points, "similarity");

		expect(distance(project(transform, [400, 0]), truth(400, 0))).toBeLessThan(
			0.001,
		);
		expect(distance(project(transform, [0, 300]), truth(0, 300))).toBeLessThan(
			0.001,
		);
	});
});

describe("fit: affine", () => {
	/** A plan scanned with a stretched axis: 5 cm per pixel across, 4 cm per pixel down. */
	const stretched = (u: number, v: number) =>
		offset(RENNES, 0.05 * u, -0.04 * v);
	const points: ControlPoint[] = [
		{ image: [0, 0], map: stretched(0, 0) },
		{ image: [400, 0], map: stretched(400, 0) },
		{ image: [0, 300], map: stretched(0, 300) },
	];

	it("places a stretched plan exactly from three points", () => {
		const { transform } = fitPlan(points, "affine");
		expect(
			distance(project(transform, [400, 300]), stretched(400, 300)),
		).toBeLessThan(0.001);
	});

	it("is what a stretched plan needs: a similarity can't fit it", () => {
		expect(fitPlan(points, "similarity").rms).toBeGreaterThan(0.5);
	});

	it("needs points that are not on one line in the image", () => {
		expect(() =>
			fitPlan(
				[
					{ image: [0, 0], map: stretched(0, 0) },
					{ image: [100, 100], map: stretched(100, 100) },
					{ image: [200, 200], map: stretched(200, 200) },
				],
				"affine",
			),
		).toThrow(GeorefError);
	});
});

describe("fit: projective", () => {
	/** A plan photographed at an angle: its corners land on a trapezoid, in metres from RENNES. */
	const quad = {
		topLeft: [0, 0],
		topRight: [30, 0],
		bottomRight: [24, -18],
		bottomLeft: [6, -18],
	} as const;
	const at = ([east, north]: readonly [number, number]) =>
		offset(RENNES, east, north);
	const corners: ControlPoint[] = [
		{ image: [0, 0], map: at(quad.topLeft) },
		{ image: [400, 0], map: at(quad.topRight) },
		{ image: [400, 300], map: at(quad.bottomRight) },
		{ image: [0, 300], map: at(quad.bottomLeft) },
	];

	it("puts the image centre where the diagonals of its corners cross", () => {
		const { transform, rms } = fitPlan(corners, "projective");
		expect(rms).toBeLessThan(0.001);
		// Diagonals (0,0)–(24,−18) and (30,0)–(6,−18) cross at (15, −11.25).
		expect(
			distance(project(transform, [200, 150]), at([15, -11.25])),
		).toBeLessThan(0.001);
	});

	it("needs four points", () => {
		expect(() => fitPlan(corners.slice(0, 3), "projective")).toThrow(
			GeorefError,
		);
	});
});

describe("fit: residuals", () => {
	/** Four corners of a 20 × 15 m plan, the last one measured 1 m too far east. */
	function noisyPoints(origin: LngLat): ControlPoint[] {
		const truth = northUpPlan(origin);
		const [lon, lat] = truth(400, 300);
		return [
			{ image: [0, 0], map: truth(0, 0) },
			{ image: [400, 0], map: truth(400, 0) },
			{ image: [0, 300], map: truth(0, 300) },
			{ image: [400, 300], map: offset([lon, lat], 1, 0) },
		];
	}

	it("are zero when the points agree", () => {
		const truth = northUpPlan(RENNES);
		const { residuals } = fitPlan(
			[
				{ image: [0, 0], map: truth(0, 0) },
				{ image: [400, 300], map: truth(400, 300) },
				{ image: [400, 0], map: truth(400, 0) },
			],
			"similarity",
		);
		for (const r of residuals) expect(r).toBeLessThan(0.001);
	});

	it("are ground metres, the same at any latitude", () => {
		const equator = fitPlan(noisyPoints([0, 0]), "similarity");
		const north = fitPlan(noisyPoints([10, 60]), "similarity");

		expect(Math.max(...equator.residuals)).toBeGreaterThan(0.2);
		expect(Math.max(...equator.residuals)).toBeLessThan(1);
		for (const [i, r] of north.residuals.entries()) {
			expect(r).toBeCloseTo(equator.residuals[i] ?? Number.NaN, 3);
		}
		expect(north.rms).toBeCloseTo(equator.rms, 3);
	});
});

describe("fit: bad input", () => {
	it("needs two points to place a plan", () => {
		expect(() =>
			fitPlan([{ image: [0, 0], map: RENNES }], "similarity"),
		).toThrow(GeorefError);
	});

	it("needs points at different places in the image", () => {
		expect(() =>
			fitPlan(
				[
					{ image: [10, 10], map: RENNES },
					{ image: [10, 10], map: offset(RENNES, 5, 0) },
				],
				"similarity",
			),
		).toThrow(GeorefError);
	});
});

describe("corners", () => {
	it("lists the image corners clockwise from the top left, for MapLibre", () => {
		const truth = northUpPlan(RENNES);
		const { transform } = fitPlan(
			[
				{ image: [0, 0], map: truth(0, 0) },
				{ image: [400, 300], map: truth(400, 300) },
			],
			"similarity",
		);
		const expected = [
			truth(0, 0),
			truth(400, 0),
			truth(400, 300),
			truth(0, 300),
		];
		corners(transform, 400, 300).forEach((corner, i) => {
			expect(distance(corner, expected[i] as LngLat)).toBeLessThan(0.001);
		});
	});
});

describe("unproject", () => {
	it("finds the pixel under a map position, through a perspective", () => {
		const at = ([east, north]: [number, number]) => offset(RENNES, east, north);
		const { transform } = fitPlan(
			[
				{ image: [0, 0], map: at([0, 0]) },
				{ image: [400, 0], map: at([30, 0]) },
				{ image: [400, 300], map: at([24, -18]) },
				{ image: [0, 300], map: at([6, -18]) },
			],
			"projective",
		);
		const [u, v] = unproject(transform, at([15, -11.25]));
		expect(u).toBeCloseTo(200, 3);
		expect(v).toBeCloseTo(150, 3);
	});
});

describe("place", () => {
	it("centres a north-up plan on a point at a given scale", () => {
		const transform = place(
			{ center: RENNES, metresPerPixel: 0.05, bearing: 0 },
			400,
			300,
		);
		expect(distance(project(transform, [200, 150]), RENNES)).toBeLessThan(
			0.001,
		);
		// The top edge is 400 px × 5 cm = 20 m long and runs east.
		const left = project(transform, [0, 0]);
		const right = project(transform, [400, 0]);
		expect(distance(left, right)).toBeCloseTo(20, 2);
		expect(right[1]).toBeCloseTo(left[1], 7);
		expect(right[0]).toBeGreaterThan(left[0]);
	});
});

describe("scaleToDistance", () => {
	it.each([0, 48, 70])(
		"makes two pixels the measured distance apart, at latitude %d",
		(lat) => {
			const start = place(
				{ center: [2, lat], metresPerPixel: 0.1, bearing: 30 },
				400,
				300,
			);
			const scaled = scaleToDistance(start, [50, 60], [250, 60], 12.5);

			expect(
				distance(project(scaled, [50, 60]), project(scaled, [250, 60])),
			).toBeCloseTo(12.5, 3);
			// The first pixel stays where it was.
			expect(
				distance(project(scaled, [50, 60]), project(start, [50, 60])),
			).toBeLessThan(0.001);
		},
	);
});

describe("rotateAbout", () => {
	it("turns the plan clockwise around a pinned pixel", () => {
		const start = place(
			{ center: RENNES, metresPerPixel: 0.05, bearing: 0 },
			400,
			300,
		);
		const pin = project(start, [100, 100]);
		const rotated = rotateAbout(start, [100, 100], 90);

		expect(distance(project(rotated, [100, 100]), pin)).toBeLessThan(0.001);
		// 100 px to the right of the pin was 5 m east of it; a quarter turn puts it 5 m south.
		expect(
			distance(project(rotated, [200, 100]), offset(pin, 0, -5)),
		).toBeLessThan(0.001);
	});
});

describe("offsetBy", () => {
	it("moves the plan a number of metres east and north, keeping its scale and rotation", () => {
		const start = place(
			{ center: RENNES, metresPerPixel: 0.05, bearing: 20 },
			400,
			300,
		);
		const moved = offsetBy(start, 400, 300, 2.5, -1);
		const pixels: Pixel[] = [
			[200, 150],
			[0, 0],
			[400, 300],
		];
		for (const pixel of pixels) {
			expect(
				distance(project(moved, pixel), offset(project(start, pixel), 2.5, -1)),
			).toBeLessThan(0.001);
		}
	});
});

describe("translateTo", () => {
	it("moves the plan so a pixel lands on a point, keeping its scale and rotation", () => {
		const start = place(
			{ center: RENNES, metresPerPixel: 0.05, bearing: 20 },
			400,
			300,
		);
		// Move pixel (100, 100) 30 m east and 12 m south of where it is.
		const target = offset(project(start, [100, 100]), 30, -12);
		const moved = translateTo(start, [100, 100], target);

		expect(distance(project(moved, [100, 100]), target)).toBeLessThan(0.001);
		// Every pixel moved the same way: 30 m east and 12 m south.
		expect(
			distance(
				project(moved, [300, 250]),
				offset(project(start, [300, 250]), 30, -12),
			),
		).toBeLessThan(0.001);
	});
});

describe("dragCorner", () => {
	// A 400 × 300 px plan at 5 cm per pixel, north up: 20 × 15 m around RENNES.
	const start = place(
		{ center: RENNES, metresPerPixel: 0.05, bearing: 0 },
		400,
		300,
	);
	const TL = offset(RENNES, -10, 7.5);
	const TR = offset(RENNES, 10, 7.5);
	const BR = offset(RENNES, 10, -7.5);
	const BL = offset(RENNES, -10, -7.5);
	const TOP_RIGHT = 1;

	/** Checks the plan's corners, clockwise from the top left, within 1 cm. */
	function expectCorners(transform: Transform, expected: LngLat[]) {
		corners(transform, 400, 300).forEach((corner, i) => {
			expect(distance(corner, expected[i] as LngLat)).toBeLessThan(0.01);
		});
	}

	it("resizes the plan around the opposite corner, without turning it", () => {
		// The corner is dragged 25 m due north of BL. Along the diagonal BL → TR (20 east, 15
		// north, 25 m), that point is 15 m out (0·20 + 25·15) / 25: the plan becomes 0.6 times
		// as large, 12 × 9 m, still north up.
		const moved = dragCorner(start, 400, 300, TOP_RIGHT, offset(BL, 0, 25));
		expectCorners(moved, [
			offset(BL, 0, 9),
			offset(BL, 12, 9),
			offset(BL, 12, 0),
			BL,
		]);
	});

	it("resizes from the centre with fromCenter", () => {
		// Half the diagonal again: 1.5 times larger, around RENNES.
		const moved = dragCorner(start, 400, 300, TOP_RIGHT, offset(TR, 5, 3.75), {
			fromCenter: true,
		});
		expectCorners(moved, [
			offset(RENNES, -15, 11.25),
			offset(RENNES, 15, 11.25),
			offset(RENNES, 15, -11.25),
			offset(RENNES, -15, -11.25),
		]);
	});

	it("changes the proportions with freeAspect, keeping the edges' directions", () => {
		const moved = dragCorner(start, 400, 300, TOP_RIGHT, offset(TR, 6, 0), {
			freeAspect: true,
		});
		expectCorners(moved, [TL, offset(TR, 6, 0), offset(BR, 6, 0), BL]);
	});

	it("moves only the dragged corner with distort", () => {
		const moved = dragCorner(start, 400, 300, TOP_RIGHT, offset(TR, 3, 2), {
			distort: true,
		});
		expect(moved.kind).toBe("projective");
		expectCorners(moved, [TL, offset(TR, 3, 2), BR, BL]);
	});
});

describe("dragRotation", () => {
	// A 400 × 300 px plan at 5 cm per pixel, north up: 20 × 15 m around RENNES.
	const start = place(
		{ center: RENNES, metresPerPixel: 0.05, bearing: 0 },
		400,
		300,
	);

	function expectCorners(transform: Transform, expected: LngLat[]) {
		corners(transform, 400, 300).forEach((corner, i) => {
			expect(distance(corner, expected[i] as LngLat)).toBeLessThan(0.01);
		});
	}

	it("turns the plan around its centre so that its top faces the pointer", () => {
		// Pointer due east: a quarter turn clockwise, (x, y) → (y, −x) around the centre.
		const turned = dragRotation(start, 400, 300, offset(RENNES, 30, 0));
		expectCorners(turned, [
			offset(RENNES, 7.5, 10),
			offset(RENNES, 7.5, -10),
			offset(RENNES, -7.5, -10),
			offset(RENNES, -7.5, 10),
		]);
	});

	it("snaps to 15° steps with snap", () => {
		// Pointer at a bearing of 50°, snapped to 45°: (x, y) → ((x + y)·√½, (y − x)·√½).
		const pointer = offset(
			RENNES,
			30 * Math.sin((50 * Math.PI) / 180),
			30 * Math.cos((50 * Math.PI) / 180),
		);
		const turned = dragRotation(start, 400, 300, pointer, { snap: true });
		const r = Math.SQRT1_2;
		expectCorners(turned, [
			offset(RENNES, (-10 + 7.5) * r, (7.5 + 10) * r),
			offset(RENNES, (10 + 7.5) * r, (7.5 - 10) * r),
			offset(RENNES, (10 - 7.5) * r, (-7.5 - 10) * r),
			offset(RENNES, (-10 - 7.5) * r, (-7.5 + 10) * r),
		]);
	});
});

describe("positionOf and moveTo: a plan placed by numbers", () => {
	const rad = (deg: number) => (deg * Math.PI) / 180;
	/** The point `metres` away from `from` towards `bearing` (degrees clockwise from north). */
	const toward = (from: LngLat, bearing: number, metres: number) =>
		offset(
			from,
			metres * Math.sin(rad(bearing)),
			metres * Math.cos(rad(bearing)),
		);
	/** 400 × 300 px, 5 cm a pixel: 20 m wide, 15 m tall, its top facing 30°. */
	const plan = place(
		{ center: RENNES, metresPerPixel: 0.05, bearing: 30 },
		400,
		300,
	);

	it("reads a plan's centre, the bearing its top faces, and its ground width", () => {
		const { center, bearing, width } = positionOf(plan, 400, 300);
		expect(distance(center, RENNES)).toBeLessThan(0.001);
		expect(bearing).toBeCloseTo(30, 6);
		expect(width).toBeCloseTo(20, 3);
	});

	it("gives bearings from 0 to 360", () => {
		const west = place(
			{ center: RENNES, metresPerPixel: 0.05, bearing: -90 },
			400,
			300,
		);
		expect(positionOf(west, 400, 300).bearing).toBeCloseTo(270, 6);
	});

	it("moves the plan, unturned and unscaled, to a new centre", () => {
		const target = offset(RENNES, 120, -45);
		const moved = moveTo(plan, 400, 300, { center: target });
		const position = positionOf(moved, 400, 300);
		expect(distance(position.center, target)).toBeLessThan(0.001);
		expect(position.bearing).toBeCloseTo(30, 6);
		expect(position.width).toBeCloseTo(20, 3);
	});

	it("turns the plan around its centre to face a bearing", () => {
		const turned = moveTo(plan, 400, 300, { bearing: 120 });
		expect(distance(project(turned, [200, 150]), RENNES)).toBeLessThan(0.001);
		// The middle of its top edge, 7.5 m from the centre, towards 120°.
		expect(
			distance(project(turned, [200, 0]), toward(RENNES, 120, 7.5)),
		).toBeLessThan(0.001);
	});

	it("scales the plan around its centre to a ground width, keeping its proportions", () => {
		const scaled = moveTo(plan, 400, 300, { width: 40 });
		// The middle of its right edge, 20 m from the centre at right angles to its top.
		expect(
			distance(project(scaled, [400, 150]), toward(RENNES, 120, 20)),
		).toBeLessThan(0.001);
		expect(
			distance(project(scaled, [200, 0]), toward(RENNES, 30, 15)),
		).toBeLessThan(0.001);
	});

	it("moves and turns a perspective plan as a whole, keeping its shape", () => {
		const truth = northUpPlan(RENNES);
		// A plan photographed at an angle: its top edge drawn narrower.
		const warped = fitPlan(
			[
				{ image: [0, 0], map: truth(40, 0) },
				{ image: [400, 0], map: truth(360, 0) },
				{ image: [400, 300], map: truth(400, 300) },
				{ image: [0, 300], map: truth(0, 300) },
			],
			"projective",
		).transform;
		const pixels = [
			[0, 0],
			[400, 0],
			[400, 300],
			[0, 300],
		] as const;
		const sides = (t: Transform) =>
			pixels.map((p, i) =>
				distance(
					project(t, [...p]),
					project(t, [...(pixels[(i + 1) % 4] ?? p)]),
				),
			);
		const target = offset(RENNES, 30, 30);
		const moved = moveTo(warped, 400, 300, { center: target, bearing: 90 });
		expect(distance(positionOf(moved, 400, 300).center, target)).toBeLessThan(
			0.001,
		);
		expect(positionOf(moved, 400, 300).bearing).toBeCloseTo(90, 6);
		sides(moved).forEach((side, i) => {
			expect(side).toBeCloseTo(sides(warped)[i] ?? 0, 3);
		});
	});
});
