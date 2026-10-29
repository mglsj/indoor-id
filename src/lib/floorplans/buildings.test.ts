import { describe, expect, it } from "vitest";
import { node, relation, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { buildingName, buildingsUnder } from "./buildings.ts";

const graph = Graph.fromEntities([
	node("n1", {}, [0, 0]),
	node("n2", {}, [1, 0]),
	node("n3", {}, [1, 1]),
	node("n4", {}, [0, 1]),
	node("n5", {}, [2, 0]),
	node("n6", {}, [2, 1]),
	// A school, around (0.5, 0.5).
	way("w1", ["n1", "n2", "n3", "n4", "n1"], {
		building: "school",
		name: "Lycée",
	}),
	// A building multipolygon next to it, east.
	way("w2", ["n2", "n5", "n6", "n3", "n2"]),
	relation("r1", [{ ref: "w2", role: "outer" }], {
		type: "multipolygon",
		building: "yes",
		"addr:housenumber": "3",
		"addr:street": "Rue Haute",
	}),
	// Not a building.
	way("w3", ["n1", "n2", "n5", "n1"], { indoor: "room" }),
]);

describe("buildingsUnder", () => {
	it("lists the buildings drawn by the ways under the plan, the one around its centre first", () => {
		expect(buildingsUnder(graph, ["w1", "w2", "w3"], [1.5, 0.5])).toEqual([
			{ id: "r1", name: "3 Rue Haute" },
			{ id: "w1", name: "Lycée" },
		]);
		expect(
			buildingsUnder(graph, ["w2", "w1", "w1"], [0.5, 0.5]).map((b) => b.id),
		).toEqual(["w1", "r1"]);
	});
});

describe("buildingName", () => {
	it("is the name, else the address, else the id", () => {
		expect(buildingName({ name: "Lycée", "addr:street": "Rue" }, "w1")).toBe(
			"Lycée",
		);
		expect(buildingName({ "addr:street": "Rue Haute" }, "w1")).toBe(
			"Rue Haute",
		);
		expect(buildingName({ building: "yes" }, "w1")).toBe("Building w1");
	});
});
