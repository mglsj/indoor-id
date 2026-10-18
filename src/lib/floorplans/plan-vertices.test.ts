import { describe, expect, it } from "vitest";
import { type LngLat, place } from "./georef.ts";
import { PlanVertices } from "./plan-vertices.ts";
import { distance, offset, RENNES } from "./test-geometry.ts";
import type { VectorContent } from "./vector.ts";

/**
 * A 400 × 300 unit drawing, 5 cm a unit, north up and centred on RENNES: unit (u, v) lies
 * 0.05·u m east and 0.05·v m south of its top left, 10 m west and 7.5 m north of RENNES.
 */
const transform = place(
	{ center: RENNES, metresPerPixel: 0.05, bearing: 0 },
	400,
	300,
);
const topLeft = offset(RENNES, -10, 7.5);
const at = (u: number, v: number) => offset(topLeft, 0.05 * u, -0.05 * v);

/**
 * A wall from (100, 100) to (200, 100) and on to (200, 200) on the layer Walls; a filled
 * triangle (300, 100), (350, 100), (300, 150) on Furniture.
 */
const drawing: VectorContent = {
	size: { width: 400, height: 300 },
	segments: new Float32Array([100, 100, 200, 100, 200, 100, 200, 200]),
	segmentStyles: new Uint32Array([0, 0]),
	triangles: new Float32Array([300, 100, 350, 100, 300, 150]),
	triangleStyles: new Uint32Array([1]),
	styles: [
		{ color: [0, 0, 0, 255], width: 0, layer: 0 },
		{ color: [0, 0, 0, 255], width: 0, layer: 1 },
	],
	texts: [],
	layers: [
		{ id: "7R", name: "Walls", visible: true },
		{ id: "9R", name: "Furniture", visible: true },
	],
};

/** The part of the map within `metres` of a point. */
function around([lon, lat]: LngLat, metres: number) {
	const [west, south] = offset([lon, lat], -metres, -metres);
	const [east, north] = offset([lon, lat], metres, metres);
	return { west, south, east, north };
}

/** Positions sorted west to east, then north to south, for comparison. */
const sorted = (positions: LngLat[]) =>
	[...positions].sort((a, b) => a[0] - b[0] || b[1] - a[1]);

describe("PlanVertices: a vector plan's corners and line ends, to snap to", () => {
	const vertices = new PlanVertices(drawing);

	it("gives the vertices in a part of the map, each once, where the plan puts them", () => {
		// Around (200, 100): the wall's corner, shared by both of its segments.
		const found = vertices.near(transform, around(at(200, 100), 1));
		expect(found).toHaveLength(1);
		expect(distance(found[0] ?? [0, 0], at(200, 100))).toBeLessThan(0.001);

		// 6 m around the middle of the wall: its three points (100 to 200 units is 5 m).
		const wall = sorted(vertices.near(transform, around(at(150, 150), 6)));
		const expected = sorted([at(100, 100), at(200, 100), at(200, 200)]);
		expect(wall).toHaveLength(3);
		for (const [i, p] of wall.entries()) {
			expect(distance(p, expected[i] ?? [0, 0])).toBeLessThan(0.001);
		}
	});

	it("gives filled shapes' corners too", () => {
		const found = vertices.near(transform, around(at(350, 100), 1));
		expect(found).toHaveLength(1);
		expect(distance(found[0] ?? [0, 0], at(350, 100))).toBeLessThan(0.001);
	});

	it("leaves out the vertices of hidden CAD layers", () => {
		const everything = around(at(200, 150), 50);
		expect(vertices.near(transform, everything)).toHaveLength(6);
		expect(vertices.near(transform, everything, new Set(["9R"]))).toHaveLength(
			3,
		);
	});

	it("finds them wherever the plan is moved", () => {
		const moved = place(
			{ center: offset(RENNES, 100, 0), metresPerPixel: 0.05, bearing: 0 },
			400,
			300,
		);
		expect(vertices.near(moved, around(at(200, 100), 1))).toHaveLength(0);
		const found = vertices.near(moved, around(offset(at(200, 100), 100, 0), 1));
		expect(found).toHaveLength(1);
	});
});
