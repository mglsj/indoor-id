import { describe, expect, it } from "vitest";
import type { NodeId, WayId } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import type { Tags } from "#lib/osm/tags.ts";
import { addressSuggestions } from "./address.ts";

const LON = -1.69;
const LAT = 48.13;
/** About 111 m north per 0.001° here, 74 m east. */
let next = 1;
function line(id: WayId, points: [number, number][], tags: Tags) {
	const nodes = points.map(([dx, dy]) =>
		node(`n${next++}` as NodeId, {}, [LON + dx, LAT + dy]),
	);
	return [
		...nodes,
		way(
			id,
			nodes.map((n) => n.id),
			tags,
		),
	];
}
const square = (id: WayId, half: number, tags: Tags) => {
	const entities = line(
		id,
		[
			[-half, -half],
			[half, -half],
			[half, half],
			[-half, half],
		],
		tags,
	);
	const w = entities.at(-1) as ReturnType<typeof way>;
	return [
		...entities.slice(0, -1),
		{ ...w, nodes: [...w.nodes, w.nodes[0] as NodeId] },
	];
};

const graph = Graph.fromEntities([
	...square("w1", 0.0001, { indoor: "room" }),
	...square("w2", 0.0005, {
		building: "yes",
		"addr:housenumber": "12",
		"addr:postcode": "35000",
	}),
	node("n900", { entrance: "yes", "addr:housenumber": "12bis" }, [
		LON + 0.0003,
		LAT,
	]),
	...line(
		"w10",
		[
			[-0.001, 0.001],
			[0.001, 0.001],
		],
		{ highway: "residential", name: "Rue A" },
	),
	...line(
		"w11",
		[
			[-0.001, 0.0005],
			[0.001, 0.0005],
		],
		{ highway: "footway", name: "Allée C" },
	),
	...line(
		"w12",
		[
			[-0.001, 0.003],
			[0.001, 0.003],
		],
		{ highway: "primary", name: "Rue Far" },
	),
	...line(
		"w13",
		[
			[-0.001, 0.0008],
			[0.001, 0.0008],
		],
		{ highway: "service" },
	),
	...line(
		"w14",
		[
			[-0.001, 0.0007],
			[0.001, 0.0007],
		],
		{ waterway: "canal", name: "Canal" },
	),
	node("n901", { place: "square", name: "Place Ste-Anne" }, [LON, LAT + 0.001]),
	node("n902", { place: "city", name: "Rennes" }, [LON + 0.001, LAT]),
	node("n903", { postal_code: "35700" }, [LON, LAT - 0.001]),
]);
const suggest = (part: string) =>
	addressSuggestions(graph, "w1", part).map((s) => s.value);

describe("addressSuggestions, from the data around (iD's address field)", () => {
	it("offers the named streets within 200 m, the nearest first", () => {
		expect(suggest("street")).toEqual(["Allée C", "Rue A"]);
	});

	it("offers places, cities and postcodes near the feature", () => {
		// Any place counts for the place part, the city too (as iD).
		expect(suggest("place")).toEqual(["Rennes", "Place Ste-Anne"]);
		expect(suggest("city")).toEqual(["Rennes"]);
		expect(suggest("postcode")).toEqual(["35000", "35700"]);
	});

	it("offers the house numbers of the building around the feature, and of points in it", () => {
		expect(suggest("housenumber")).toEqual(["12", "12bis"]);
	});

	it("leaves out the feature's own address", () => {
		expect(
			addressSuggestions(graph, "w2", "postcode").map((s) => s.value),
		).toEqual(["35700"]);
	});
});
