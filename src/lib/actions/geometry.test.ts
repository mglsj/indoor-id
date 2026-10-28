import { describe, expect, it } from "vitest";
import type { NodeId } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import {
	addNode,
	addVertex,
	addWay,
	insertNodeInSegment,
	insertNodeInWay,
	moveNode,
} from "./geometry.ts";

describe("addNode", () => {
	it("creates a new node, without version", () => {
		const graph = Graph.fromEntities([]);
		const id = graph.newId("node");
		const after = addNode(id, [2.35, 48.85], { amenity: "toilets" })(graph);

		expect(after.entity(id)).toEqual({
			type: "node",
			id,
			loc: [2.35, 48.85],
			tags: { amenity: "toilets" },
		});
		expect(after.changes().created.map((e) => e.id)).toEqual([id]);
	});
});

describe("moveNode", () => {
	it("moves a node shared by several ways, which all follow", () => {
		const graph = Graph.fromEntities([
			node("n1"),
			node("n2", {}, [1, 1]),
			node("n3"),
			way("w1", ["n1", "n2"]),
			way("w2", ["n2", "n3"]),
		]);
		const after = moveNode("n2", [5, 5])(graph);

		expect(after.entity("n2")).toMatchObject({ loc: [5, 5] });
		expect(
			after
				.parentWays("n2")
				.map((w) => w.id)
				.sort(),
		).toEqual(["w1", "w2"]);
		expect(after.changes().modified.map((e) => e.id)).toEqual(["n2"]);
	});
});

describe("addWay", () => {
	it("creates a way through existing nodes", () => {
		const graph = Graph.fromEntities([node("n1"), node("n2"), node("n3")]);
		const id = graph.newId("way");
		const after = addWay(id, ["n1", "n2", "n3", "n1"], { indoor: "room" })(
			graph,
		);

		expect(after.entity(id)).toMatchObject({
			nodes: ["n1", "n2", "n3", "n1"],
			tags: { indoor: "room" },
		});
		expect(after.parentWays("n2").map((w) => w.id)).toEqual([id]);
	});

	it("fails when a node doesn't exist", () => {
		const graph = Graph.fromEntities([node("n1")]);
		expect(() => addWay("w-1", ["n1", "n2"])(graph)).toThrow("n2");
	});
});

describe("insertNodeInWay", () => {
	it("makes a node a vertex of a way, e.g. a door on a wall", () => {
		const graph = Graph.fromEntities([
			node("n1"),
			node("n2"),
			node("n3", { door: "hinged" }),
			way("w1", ["n1", "n2"]),
		]);
		const after = insertNodeInWay("w1", "n3", 1)(graph);

		expect(after.entity("w1")).toMatchObject({ nodes: ["n1", "n3", "n2"] });
		expect(after.parentWays("n3").map((w) => w.id)).toEqual(["w1"]);
	});
});

describe("insertNodeInSegment", () => {
	it("puts the node into every way with that side, either way round", () => {
		// Two rooms sharing the side n2–n3, a wall along it, and a way elsewhere.
		const graph = Graph.fromEntities([
			...["n1", "n2", "n3", "n4", "n5", "n6", "n7"].map((id) =>
				node(id as NodeId),
			),
			way("w1", ["n1", "n2", "n3", "n1"], { indoor: "room" }),
			way("w2", ["n3", "n2", "n4", "n3"], { indoor: "room" }),
			way("w3", ["n2", "n3"], { indoor: "wall" }),
			way("w4", ["n2", "n5", "n3"]),
		]);
		const after = insertNodeInSegment("n7", "n2", "n3")(graph);

		expect(after.entity("w1")).toMatchObject({
			nodes: ["n1", "n2", "n7", "n3", "n1"],
		});
		expect(after.entity("w2")).toMatchObject({
			nodes: ["n3", "n7", "n2", "n4", "n3"],
		});
		expect(after.entity("w3")).toMatchObject({ nodes: ["n2", "n7", "n3"] });
		// n2 and n3 are not next to each other there.
		expect(after.entity("w4")).toBe(graph.entity("w4"));
	});
});

describe("addVertex", () => {
	it("creates an untagged node on the side", () => {
		const graph = Graph.fromEntities([
			node("n1"),
			node("n2", {}, [2, 0]),
			way("w1", ["n1", "n2"]),
		]);
		const id = graph.newId("node");
		const after = addVertex(id, [1, 0], "n1", "n2")(graph);

		expect(after.entity(id)).toMatchObject({ loc: [1, 0], tags: {} });
		expect(after.entity("w1")).toMatchObject({ nodes: ["n1", id, "n2"] });
	});
});
