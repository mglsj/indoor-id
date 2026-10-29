import { describe, expect, it } from "vitest";
import type { Loc } from "#lib/osm/entity.ts";
import { node, relation, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { EditHistory } from "#lib/state/edit-history.svelte.ts";
import { featureDrag, nodesOf } from "./feature-drag.ts";
import type { MapPoint } from "./mode.ts";

const at = (lon: number, lat: number): MapPoint => ({
	point: { x: 0, y: 0 },
	lngLat: [lon, lat],
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
});

/** A room n1–n4 sharing its side n2–n3 with a room n2, n5, n6, n3; a hole w3 in a multipolygon. */
const graph = () =>
	Graph.fromEntities([
		node("n1", {}, [0, 0]),
		node("n2", {}, [0.001, 0]),
		node("n3", {}, [0.001, 0.001]),
		node("n4", {}, [0, 0.001]),
		node("n5", {}, [0.002, 0]),
		node("n6", {}, [0.002, 0.001]),
		way("w1", ["n1", "n2", "n3", "n4", "n1"], { indoor: "room" }),
		way("w2", ["n2", "n5", "n6", "n3", "n2"], { indoor: "room" }),
		relation("r1", [
			{ ref: "w1", role: "outer" },
			{ ref: "r2", role: "" },
		]),
		relation("r2", [{ ref: "w2", role: "outer" }]),
	]);

const locOf = (g: Graph, id: `n${number}`): Loc | undefined => {
	const n = g.entity(id);
	return n?.type === "node" ? n.loc : undefined;
};

describe("nodesOf", () => {
	it("gives the nodes of points, ways and a relation's ways", () => {
		expect([...nodesOf(graph(), ["w1"])].sort()).toEqual([
			"n1",
			"n2",
			"n3",
			"n4",
		]);
		// Not the ways of a relation inside it.
		expect(nodesOf(graph(), ["r1"]).size).toBe(4);
		expect([...nodesOf(graph(), ["n5", "w2"])].sort()).toEqual([
			"n2",
			"n3",
			"n5",
			"n6",
		]);
	});
});

describe("featureDrag", () => {
	it("moves the selection with the pointer, shown live, in one step on release", () => {
		const history = new EditHistory(graph());
		const drag = featureDrag(["w1"], at(0.0005, 0.0005), history);
		drag.move(at(0.0015, 0.0005));
		expect(locOf(history.graph, "n1")?.[0]).toBeCloseTo(0.001, 9);
		expect(history.canUndo).toBe(false);
		drag.end(at(0.0005, 0.0015));
		expect(history.canUndo).toBe(true);
		// Moved 0.001° north: the shared corner too, the other room's own corner not.
		expect(locOf(history.graph, "n1")?.[0]).toBeCloseTo(0, 9);
		expect(locOf(history.graph, "n1")?.[1]).toBeCloseTo(0.001, 7);
		expect(locOf(history.graph, "n2")?.[1]).toBeCloseTo(0.001, 7);
		expect(locOf(history.graph, "n5")).toEqual([0.002, 0]);
		history.undo();
		expect(locOf(history.graph, "n1")).toEqual([0, 0]);
	});

	it("leaves everything where it was when cancelled", () => {
		const history = new EditHistory(graph());
		const drag = featureDrag(["w1", "w2"], at(0, 0), history);
		drag.move(at(0.001, 0));
		drag.cancel();
		expect(locOf(history.graph, "n6")).toEqual([0.002, 0.001]);
		expect(history.canUndo).toBe(false);
	});
});
