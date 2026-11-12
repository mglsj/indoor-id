import { describe, expect, it } from "vitest";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { editedFeatures } from "./edited.ts";

const base = () =>
	Graph.fromEntities([
		node("n1", {}, [0, 0]),
		node("n2", {}, [1, 0]),
		node("n3", {}, [1, 1]),
		node("n4", { amenity: "toilets" }, [2, 2]),
		way("w1", ["n1", "n2", "n3", "n1"], { indoor: "room" }),
		way("w2", ["n3", "n2"], { indoor: "wall" }),
	]);

describe("editedFeatures", () => {
	it("lists nothing without edits", () => {
		expect(editedFeatures(base())).toEqual(new Map());
	});

	it("tells added, retagged and reshaped features apart, as iD", () => {
		let graph = base();
		const n1 = graph.entity("n1");
		const w2 = graph.entity("w2");
		if (n1?.type !== "node" || w2?.type !== "way") throw new Error();
		graph = graph
			.replace({ ...n1, loc: [0, -1] })
			.replace({ ...w2, tags: { indoor: "wall", name: "East" } })
			.replace(node("n-1", { shop: "kiosk" }, [3, 3]));
		expect(editedFeatures(graph)).toEqual(
			new Map([
				["n-1", "added"],
				["w2", "retagged"],
				// Its untagged node moved.
				["w1", "geometry"],
			]),
		);
	});

	it("marks a moved tagged node, and a way whose nodes changed", () => {
		let graph = base();
		const n4 = graph.entity("n4");
		const w2 = graph.entity("w2");
		if (n4?.type !== "node" || w2?.type !== "way") throw new Error();
		graph = graph
			.replace({ ...n4, loc: [5, 5] })
			.replace({ ...w2, nodes: ["n3", "n2", "n1"] });
		expect(editedFeatures(graph)).toEqual(
			new Map([
				["n4", "geometry"],
				["w2", "geometry"],
			]),
		);
	});
});
