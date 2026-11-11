import { describe, expect, it } from "vitest";
import type { Loc, NodeId } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { fromLocal, local } from "#lib/osm/geometry.ts";
import { Graph } from "#lib/osm/graph.ts";
import {
	moveSide,
	offsetWay,
	rotateNodes,
	scaleNodes,
	setSideLength,
	squareToFrame,
	translateNodes,
} from "./transform.ts";

const O: Loc = [11.575, 48.137];
const at = (east: number, north: number) => fromLocal(O, [east, north]);
const round = (v: number) => Math.round(v * 1000) / 1000 + 0;

/** A closed way through these points, in metres from O. */
function shape(...points: [number, number][]) {
	const ids = points.map((_, i) => `n${i + 1}` as NodeId);
	return Graph.fromEntities([
		...points.map(([e, n], i) => node(ids[i] as NodeId, {}, at(e, n))),
		way("w1", [...ids, ids[0] as NodeId], { indoor: "room" }),
	]);
}

/** Where a way's nodes are, in metres from O (the closing node left out). */
function corners(graph: Graph, id = "w1") {
	const w = graph.entity(id as `w${number}`);
	if (w?.type !== "way") return [];
	const ids = w.nodes[0] === w.nodes.at(-1) ? w.nodes.slice(0, -1) : w.nodes;
	return ids.map((n) => {
		const e = graph.entity(n);
		return e?.type === "node" ? local(O, e.loc).map(round) : [];
	});
}

/** A 4 × 3 m room with its south-west corner at O. */
const room = () => shape([0, 0], [4, 0], [4, 3], [0, 3]);
const all = new Set<NodeId>(["n1", "n2", "n3", "n4"]);

describe("translate, rotate and scale nodes", () => {
	it("moves nodes by metres east and north", () => {
		const moved = translateNodes(all, [0.1, -1])(room());
		expect(corners(moved)).toEqual([
			[0.1, -1],
			[4.1, -1],
			[4.1, 2],
			[0.1, 2],
		]);
	});

	it("turns nodes counterclockwise about a centre", () => {
		const turned = rotateNodes(all, at(0, 0), 90)(room());
		expect(corners(turned)).toEqual([
			[0, 0],
			[0, 4],
			[-3, 4],
			[-3, 0],
		]);
	});

	it("scales nodes from a fixed point", () => {
		const scaled = scaleNodes(all, at(4, 3), 0.5)(room());
		expect(corners(scaled)).toEqual([
			[2, 1.5],
			[4, 1.5],
			[4, 3],
			[2, 3],
		]);
	});
});

describe("setSideLength", () => {
	it("moves the side's second end along it", () => {
		const longer = setSideLength("w1", 0, 5.5)(room());
		expect(corners(longer)[1]).toEqual([5.5, 0]);
		expect(corners(longer)[2]).toEqual([4, 3]);
	});

	it("the closing side moves the first node", () => {
		// Side 3 runs from (0, 3) to (0, 0).
		const shorter = setSideLength("w1", 3, 2)(room());
		expect(corners(shorter)[0]).toEqual([0, 1]);
	});
});

describe("moveSide", () => {
	it("moves a side out, its neighbours keeping their directions", () => {
		// The east side (1: (4, 0) → (4, 3)) 1.5 m to its right, east.
		const wider = moveSide("w1", 1, -1.5)(room());
		expect(corners(wider)).toEqual([
			[0, 0],
			[5.5, 0],
			[5.5, 3],
			[0, 3],
		]);
	});

	it("keeps a slanted neighbour's direction", () => {
		const trapezoid = shape([0, 0], [4, 0], [3, 3], [0, 3]);
		// The north side (2: (3, 3) → (0, 3)) 1 m north: the slanted east side runs on to y = 4.
		const taller = moveSide("w1", 2, -1)(trapezoid);
		expect(corners(taller)[2]).toEqual([2.667, 4]);
		expect(corners(taller)[3]).toEqual([0, 4]);
	});
});

describe("offsetWay", () => {
	it("a parallel copy of a room, 0.5 m inside", () => {
		const { graph, id } = offsetWay("w1", 0.5)(room());
		expect(corners(graph, id)).toEqual([
			[0.5, 0.5],
			[3.5, 0.5],
			[3.5, 2.5],
			[0.5, 2.5],
		]);
		// A new way of new nodes, with the room's tags; the room is untouched.
		const copy = graph.entity(id);
		expect(copy?.type === "way" && copy.tags).toEqual({ indoor: "room" });
		expect(copy?.type === "way" && copy.nodes[0]?.startsWith("n-")).toBe(true);
		expect(corners(graph)).toEqual(corners(room()));
	});

	it("outside with a negative distance", () => {
		const { graph, id } = offsetWay("w1", -1)(room());
		expect(corners(graph, id)[0]).toEqual([-1, -1]);
	});
});

describe("squareToFrame", () => {
	it("squares a skewed room to the frame's axes", () => {
		const skewed = shape([0, 0], [4, 0.2], [4.1, 3], [0, 3.1]);
		const squared = squareToFrame("w1", 0)(skewed);
		const c = corners(squared);
		// Each side along an axis: south and north level, east and west straight up.
		expect(c[0]?.[1]).toBeCloseTo(c[1]?.[1] ?? 0, 6);
		expect(c[2]?.[1]).toBeCloseTo(c[3]?.[1] ?? 0, 6);
		expect(c[1]?.[0]).toBeCloseTo(c[2]?.[0] ?? 0, 6);
		expect(c[3]?.[0]).toBeCloseTo(c[0]?.[0] ?? 0, 6);
		// Through the sides' middles: the south side at y = 0.1.
		expect(c[0]?.[1]).toBeCloseTo(0.1, 3);
	});

	it("to a turned frame", () => {
		const squared = squareToFrame("w1", 30)(room());
		const c = corners(squared);
		const [x0 = 0, y0 = 0] = c[0] as number[];
		const [x1 = 0, y1 = 0] = c[1] as number[];
		expect((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI).toBeCloseTo(30, 2);
	});
});
