import { describe, expect, it } from "vitest";
import type { Way } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { fromLocal } from "#lib/osm/geometry.ts";
import { Graph } from "#lib/osm/graph.ts";
import { tracePath } from "./trace.ts";

const at = (e: number, n: number) => fromLocal([13.4, 52.5], [e, n]);

/**
 * A room on level 0 with corners n1 (0,0), n2 (10,0), n3 (10,10), n4 (0,10) and a node n5 on
 * its south side at (5,0); a corridor on level 1 joined to it at n3 through n6 (20,10); and a
 * wall n2–n7 (10,-10) on level 0.
 */
const graph = Graph.fromEntities([
	node("n1", {}, at(0, 0)),
	node("n5", {}, at(5, 0)),
	node("n2", {}, at(10, 0)),
	node("n3", {}, at(10, 10)),
	node("n4", {}, at(0, 10)),
	node("n6", {}, at(20, 10)),
	node("n7", {}, at(10, -10)),
	way("w1", ["n1", "n5", "n2", "n3", "n4", "n1"], {
		indoor: "room",
		level: "0",
	}),
	way("w2", ["n3", "n6"], { indoor: "corridor", level: "1" }),
	way("w3", ["n2", "n7"], { indoor: "wall", level: "0" }),
]);
const onLevel0 = (w: Way) => w.tags.level === "0";

describe("tracePath (P6: tracing along outlines)", () => {
	it("follows an outline the short way round, between its ends", () => {
		// n5 → n4: through n1 (15 m) rather than n2 and n3 (25 m).
		expect(tracePath(graph, "n5", "n4", onLevel0)).toEqual(["n1"]);
		expect(tracePath(graph, "n1", "n2", onLevel0)).toEqual(["n5"]);
	});

	it("crosses from one way to another where they share a node", () => {
		expect(tracePath(graph, "n5", "n7", onLevel0)).toEqual(["n2"]);
	});

	it("keeps to the ways it may follow", () => {
		expect(tracePath(graph, "n2", "n6", onLevel0)).toBeNull();
	});

	it("gives an empty path between neighbours, and none to itself", () => {
		expect(tracePath(graph, "n2", "n3", onLevel0)).toEqual([]);
		expect(tracePath(graph, "n2", "n2", onLevel0)).toBeNull();
	});
});
