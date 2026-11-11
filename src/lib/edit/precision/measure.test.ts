import { describe, expect, test } from "vitest";
import type { Loc } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { fromLocal } from "#lib/osm/geometry.ts";
import { Graph } from "#lib/osm/graph.ts";
import { measure } from "./measure.ts";

const O: Loc = [11.575, 48.137];
const at = (east: number, north: number) => fromLocal(O, [east, north]);

const graph = Graph.fromEntities([
	node("n1", {}, at(0, 0)),
	node("n2", {}, at(4, 0)),
	node("n3", {}, at(4, 3)),
	node("n4", {}, at(0, 3)),
	way("w1", ["n1", "n2", "n3", "n4", "n1"], { indoor: "room" }),
	way("w2", ["n1", "n3"]),
]);

describe("measure", () => {
	test("a 4 × 3 m room: 14 m around, 12 m², its four sides", () => {
		const m = measure(graph, "w1");
		expect(m?.length).toBeCloseTo(14, 4);
		expect(m?.area).toBeCloseTo(12, 3);
		expect(m?.sides.map((s) => Math.round(s * 1000) / 1000)).toEqual([
			4, 3, 4, 3,
		]);
	});

	test("a line has a length and no area", () => {
		const m = measure(graph, "w2");
		expect(m?.length).toBeCloseTo(5, 4);
		expect(m?.area).toBeUndefined();
	});

	test("nothing for a node", () => {
		expect(measure(graph, "n1")).toBeNull();
	});
});
