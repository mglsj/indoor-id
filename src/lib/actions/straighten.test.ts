import { describe, expect, it } from "vitest";
import type { Loc, NodeId } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { fromLocal, local } from "#lib/osm/geometry.ts";
import { Graph } from "#lib/osm/graph.ts";
import { makeSymmetric, straightenToFrame } from "./straighten.ts";

const O: Loc = [78.3499, 17.4456];
const at = (east: number, north: number) => fromLocal(O, [east, north]);

/** A closed building through these points, in metres from O. */
function shape(...points: [number, number][]) {
	const ids = points.map((_, i) => `n${i + 1}` as NodeId);
	return Graph.fromEntities([
		...points.map(([e, n], i) => node(ids[i] as NodeId, {}, at(e, n))),
		way("w1", [...ids, ids[0] as NodeId], { building: "yes" }),
	]);
}

/** Where the way's nodes are, in metres from O (the closing node left out). */
function corners(graph: Graph): [number, number][] {
	const w = graph.entity("w1");
	if (w?.type !== "way") return [];
	return w.nodes.slice(0, -1).map((n) => {
		const e = graph.entity(n);
		return e?.type === "node" ? local(O, e.loc) : [Number.NaN, Number.NaN];
	});
}

/** Each side's direction in degrees, counterclockwise from east, in [0, 360). */
function directions(points: [number, number][]): number[] {
	return points.map((p, i) => {
		const q = points[(i + 1) % points.length] as [number, number];
		const d = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
		return (d + 360) % 360;
	});
}

/** How far an angle is from the nearest multiple of `step`, after turning by `frame`. */
const offStep = (angle: number, step: number, frame = 0) => {
	const r = (((angle - frame) % step) + step) % step;
	return Math.min(r, step - r);
};

/**
 * A 20 × 12 m building with its north-east corner cut at 45° (3 m along each side), drawn by
 * hand: every corner up to 0.4 m off.
 */
const chamfered = () =>
	shape([0.2, -0.1], [20.3, 0.3], [19.8, 9.2], [16.9, 12.1], [-0.3, 11.8]);

describe("straightenToFrame", () => {
	it("turns every side to a multiple of 45° from the frame", () => {
		const straight = corners(straightenToFrame("w1", 0, 45)(chamfered()));
		for (const d of directions(straight))
			expect(offStep(d, 45)).toBeLessThan(1e-6);
	});

	it("keeps the outline where it was drawn, each side through its middle", () => {
		const c = corners(straightenToFrame("w1", 0, 45)(chamfered()));
		// The south side through the middle of (0.2, -0.1)–(20.3, 0.3): y = 0.1.
		expect(c[0]?.[1]).toBeCloseTo(0.1, 6);
		expect(c[1]?.[1]).toBeCloseTo(0.1, 6);
		// The 45° cut between the east and north sides, still about 3 m along each.
		const cut = Math.hypot(
			(c[3]?.[0] ?? 0) - (c[2]?.[0] ?? 0),
			(c[3]?.[1] ?? 0) - (c[2]?.[1] ?? 0),
		);
		expect(cut).toBeGreaterThan(3.5);
		expect(cut).toBeLessThan(4.8);
	});

	it("measures angles from the frame", () => {
		// The same building turned 30°.
		const r = Math.PI / 6;
		const turn = ([x, y]: [number, number]): [number, number] => [
			x * Math.cos(r) - y * Math.sin(r),
			x * Math.sin(r) + y * Math.cos(r),
		];
		const turned = shape(
			...(
				[
					[0.2, -0.1],
					[20.3, 0.3],
					[19.8, 9.2],
					[16.9, 12.1],
					[-0.3, 11.8],
				] as [number, number][]
			).map(turn),
		);
		const c = corners(straightenToFrame("w1", 30, 45)(turned));
		for (const d of directions(c))
			expect(offStep(d, 45, 30)).toBeLessThan(1e-6);
	});

	it("keeps a side drawn with several points straight, the points on it", () => {
		// The south side drawn with a wobbly middle point.
		const c = corners(
			straightenToFrame(
				"w1",
				0,
				45,
			)(shape([0, 0], [10, 0.4], [20, -0.2], [20, 10], [0, 10])),
		);
		expect(c[0]?.[1]).toBeCloseTo(c[1]?.[1] ?? 0, 6);
		expect(c[1]?.[1]).toBeCloseTo(c[2]?.[1] ?? 0, 6);
		// The middle point stays near where it was along the side.
		expect(c[1]?.[0]).toBeCloseTo(10, 1);
	});

	it("squares to 90° with a step of 90", () => {
		const c = corners(straightenToFrame("w1", 0, 90)(chamfered()));
		for (const d of directions(c)) expect(offStep(d, 90)).toBeLessThan(1e-6);
	});

	it("leaves open ways and what isn't a way alone", () => {
		const graph = Graph.fromEntities([
			node("n1", {}, at(0, 0)),
			node("n2", {}, at(5, 1)),
			way("w1", ["n1", "n2"]),
		]);
		expect(straightenToFrame("w1", 0, 45)(graph)).toBe(graph);
		expect(straightenToFrame("w9", 0, 45)(graph)).toBe(graph);
	});
});

/**
 * A T-shaped building, symmetric about x = 10 when drawn true: a 20 × 6 m bar on a 6 × 8 m
 * stem. Drawn by hand, each corner up to 0.4 m off.
 */
const tee = () =>
	shape(
		[7.2, 0.1],
		[12.9, -0.2],
		[13.1, 8.3],
		[19.8, 7.9],
		[20.3, 14.2],
		[-0.2, 13.8],
		[0.1, 8.1],
		[6.8, 7.8],
	);

describe("makeSymmetric", () => {
	it("mirrors each corner's twin across the frame axis that fits best", () => {
		const c = corners(makeSymmetric("w1", 0)(tee()));
		// Twins: 1–2, 3–8, 4–7, 5–6, across a north–south axis.
		const pairs: [number, number][] = [
			[0, 1],
			[2, 7],
			[3, 6],
			[4, 5],
		];
		const axis = ((c[0]?.[0] ?? 0) + (c[1]?.[0] ?? 0)) / 2;
		expect(axis).toBeCloseTo(10, 0);
		for (const [a, b] of pairs) {
			const p = c[a] as [number, number];
			const q = c[b] as [number, number];
			expect(p[1]).toBeCloseTo(q[1], 6);
			expect((p[0] + q[0]) / 2).toBeCloseTo(axis, 6);
		}
	});

	it("leaves a shape with no mirror twins alone", () => {
		const graph = shape([0, 0], [10, 0], [12, 3], [1, 8]);
		expect(makeSymmetric("w1", 0)(graph)).toBe(graph);
	});
});

describe("straightening, then making symmetric", () => {
	it("keeps every side at a multiple of 45°", () => {
		const straight = straightenToFrame("w1", 0, 45)(tee());
		const c = corners(makeSymmetric("w1", 0)(straight));
		for (const d of directions(c)) expect(offStep(d, 45)).toBeLessThan(1e-6);
	});
});
