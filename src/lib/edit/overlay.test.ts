import { describe, expect, it } from "vitest";
import { node, relation, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { type OverlayOptions, overlayFeatures } from "./overlay.ts";

/**
 * Two rooms side by side sharing the side n2–n3, 10 m wide (about 0.00009°), and a door n7 on
 * a lone wall. At zoom 20 a 10 m side is about 1,300 px; at zoom 13 about 10 px.
 */
const D = 0.00009;
const graph = () =>
	Graph.fromEntities([
		node("n1", {}, [0, 0]),
		node("n2", {}, [D, 0]),
		node("n3", {}, [D, D]),
		node("n4", {}, [0, D]),
		node("n5", {}, [2 * D, 0]),
		node("n6", {}, [2 * D, D]),
		way("w1", ["n1", "n2", "n3", "n4", "n1"], { indoor: "room" }),
		way("w2", ["n2", "n5", "n6", "n3", "n2"], { indoor: "room" }),
	]);

const options = (o: Partial<OverlayOptions>): OverlayOptions => ({
	selected: [],
	hover: null,
	zoom: 20,
	...o,
});

const roles = (g: Graph, o: Partial<OverlayOptions>) => {
	const out: Record<string, string[]> = {};
	for (const f of overlayFeatures(g, options(o)).features) {
		const role = f.properties["@role"];
		const id =
			f.properties["@role"] === "vertex" && f.properties["@shared"]
				? `${f.properties["@id"]}*`
				: f.properties["@id"];
		out[role] = [...(out[role] ?? []), id];
	}
	for (const list of Object.values(out)) list.sort();
	return out;
};

describe("overlayFeatures", () => {
	it("shows a selected way's vertices, junctions starred, and its sides' midpoints", () => {
		expect(roles(graph(), { selected: ["w1"] })).toEqual({
			vertex: ["n1", "n2*", "n3*", "n4"],
			midpoint: ["w1:n1:n2", "w1:n2:n3", "w1:n3:n4", "w1:n4:n1"].sort(),
		});
	});

	it("shows a hovered way's vertices, but no midpoints", () => {
		expect(roles(graph(), { hover: "w2" })).toEqual({
			vertex: ["n2*", "n3*", "n5", "n6"],
		});
	});

	it("gives a side shared by two selected ways one midpoint", () => {
		const midpoints = roles(graph(), { selected: ["w1", "w2"] }).midpoint;
		expect(midpoints).toHaveLength(7);
	});

	it("leaves out midpoints of sides too short on screen", () => {
		expect(roles(graph(), { selected: ["w1"], zoom: 13 }).midpoint).toBe(
			undefined,
		);
	});

	it("shows the vertices of a selected vertex's ways", () => {
		expect(roles(graph(), { selected: ["n5"] }).vertex).toEqual([
			"n2*",
			"n3*",
			"n5",
			"n6",
		]);
	});

	it("shows the junctions in view from zoom 18 only", () => {
		const nodesInView = () =>
			[{ id: "n1" }, { id: "n2" }, { id: "n3" }] as const;
		expect(roles(graph(), { nodesInView }).vertex).toEqual(["n2*", "n3*"]);
		expect(roles(graph(), { nodesInView, zoom: 17 })).toEqual({});
	});

	it("draws a relation's untagged members as lines, with their vertices", () => {
		const g = graph()
			.replace(way("w1", ["n1", "n2", "n3", "n4", "n1"]))
			.replace(
				relation(
					"r1",
					[
						{ ref: "w1", role: "outer" },
						{ ref: "w2", role: "inner" },
					],
					{ type: "multipolygon", indoor: "room" },
				),
			);
		const shown = roles(g, { hover: "r1" });
		// w2 keeps its own tags: the indoor layers draw it.
		expect(shown.member).toEqual(["w1"]);
		expect(shown.vertex).toHaveLength(6);
	});
});
