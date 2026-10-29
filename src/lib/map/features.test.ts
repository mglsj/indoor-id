import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import type { Entity, NodeId } from "#lib/osm/entity.ts";
import { node, relation, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { PresetIndex } from "#lib/presets/presets.ts";
import { buildFeatures, levelFilter } from "./features.ts";

/** Node id n{prefix}{i}, e.g. n12. */
const nid = (prefix: number, i: number): NodeId => `n${prefix * 10 + i}`;

/** A square of nodes n{prefix}1..4 around (x, y), with side 2 * r. */
function square(prefix: number, x: number, y: number, r = 1): Entity[] {
	return [
		node(nid(prefix, 1), {}, [x - r, y - r]),
		node(nid(prefix, 2), {}, [x + r, y - r]),
		node(nid(prefix, 3), {}, [x + r, y + r]),
		node(nid(prefix, 4), {}, [x - r, y + r]),
	];
}
const ring = (prefix: number) => [1, 2, 3, 4, 1].map((i) => nid(prefix, i));

function featuresOf(entities: Entity[]) {
	return buildFeatures(Graph.fromEntities(entities));
}

function feature(entities: Entity[], id: string) {
	return featuresOf(entities).collection.features.find(
		(f) => f.properties["@id"] === id,
	);
}

describe("buildFeatures", () => {
	it("draws a room as a polygon carrying its tags", () => {
		const room = feature(
			[...square(1, 0, 0), way("w1", ring(1), { indoor: "room", level: "0" })],
			"w1",
		);
		expect(room?.geometry).toEqual({
			type: "Polygon",
			coordinates: [
				[
					[-1, -1],
					[1, -1],
					[1, 1],
					[-1, 1],
					[-1, -1],
				],
			],
		});
		expect(room?.properties).toMatchObject({ indoor: "room", level: "0" });
	});

	it("draws a closed wall as a line, unless tagged area=yes", () => {
		const wall = [...square(1, 0, 0), way("w1", ring(1), { indoor: "wall" })];
		expect(feature(wall, "w1")?.geometry.type).toBe("LineString");

		const solid = [
			...square(1, 0, 0),
			way("w1", ring(1), { indoor: "wall", area: "yes" }),
		];
		expect(feature(solid, "w1")?.geometry.type).toBe("Polygon");
	});

	it("draws open ways as lines", () => {
		const corridor = feature(
			[
				...square(1, 0, 0),
				way("w1", ["n11", "n12", "n13"], { highway: "corridor" }),
			],
			"w1",
		);
		expect(corridor?.geometry).toEqual({
			type: "LineString",
			coordinates: [
				[-1, -1],
				[1, -1],
				[1, 1],
			],
		});
	});

	it("draws tagged nodes, including doors on walls, but not plain vertices", () => {
		const entities = [
			...square(1, 0, 0),
			node("n5", { door: "hinged" }, [0, -1]),
			way("w1", ["n11", "n5", "n12", "n13", "n14", "n11"], { indoor: "room" }),
			node("n6", { amenity: "toilets", level: "0" }, [0, 0]),
		];
		const ids = featuresOf(entities).collection.features.map(
			(f) => f.properties["@id"],
		);
		expect(ids.sort()).toEqual(["n5", "n6", "w1"]);
	});

	it("draws multipolygons with holes, and not their untagged member ways", () => {
		const entities = [
			...square(1, 0, 0, 10),
			...square(2, 0, 0, 1),
			way("w1", ["n11", "n12", "n13"]),
			way("w2", ["n13", "n14", "n11"]),
			way("w3", ring(2)),
			relation(
				"r1",
				[
					{ ref: "w1", role: "outer" },
					{ ref: "w2", role: "outer" },
					{ ref: "w3", role: "inner" },
				],
				{ type: "multipolygon", indoor: "corridor", level: "0" },
			),
		];
		const features = featuresOf(entities).collection.features;

		expect(features.map((f) => f.properties["@id"])).toEqual(["r1"]);
		expect(features[0]?.properties).toMatchObject({ indoor: "corridor" });
		expect(features[0]?.geometry).toEqual({
			type: "MultiPolygon",
			coordinates: [
				[
					[
						[-10, -10],
						[10, -10],
						[10, 10],
						[-10, 10],
						[-10, -10],
					],
					[
						[-1, -1],
						[1, -1],
						[1, 1],
						[-1, 1],
						[-1, -1],
					],
				],
			],
		});
	});

	it("tells the style how to draw each feature", () => {
		const graph = Graph.fromEntities([
			...square(1, 0, 0),
			way("w1", ring(1), {
				indoor: "room",
				ref: "B12",
				room: "toilets",
				access: "private",
			}),
			node("n5", { door: "hinged" }),
		]);
		const { collection } = buildFeatures(graph, {
			icons: new Set(["room_toilets"]),
		});
		const props = (id: string) =>
			collection.features.find((f) => f.properties["@id"] === id)?.properties;

		expect(props("w1")).toMatchObject({
			"@kind": "room",
			"@icon": "room_toilets",
			"@label": "B12",
			"@restricted": "yes",
		});
		expect(props("n5")).toMatchObject({ "@kind": "door" });
		expect(props("n5")).not.toHaveProperty("@icon");
		expect(props("n5")).not.toHaveProperty("@label");
	});

	it("gives steps their arrow, and a door its half width in pixels at zoom 17", () => {
		const steps = feature(
			[
				node("n1", {}, [0, 0]),
				node("n2", {}, [0, 1]),
				way("w1", ["n1", "n2"], { highway: "steps", incline: "down" }),
			],
			"w1",
		);
		expect(steps?.properties["@arrow"]).toBe("backward");
		// 0.9 m on the equator: 0.45 m × 512 · 2^17 px / 40,075,017 m.
		const door = feature(
			[node("n1", { door: "yes", width: "0.9" }, [0, 0])],
			"n1",
		);
		expect(Number(door?.properties["@door-r17"])).toBeCloseTo(0.7536, 3);
		// At 60° north a metre is drawn twice as long.
		const north = feature(
			[node("n1", { door: "yes", width: "0.9" }, [0, 60])],
			"n1",
		);
		expect(Number(north?.properties["@door-r17"])).toBeCloseTo(1.507, 3);
	});

	it("uses the icon of the preset matched for the feature's geometry", () => {
		const presets = new PresetIndex(
			[
				{
					id: "amenity/toilets",
					name: "Restroom",
					terms: [],
					icon: "maki-toilet",
					geometry: ["point", "area"],
					tags: { amenity: "toilets" },
					fields: [],
					moreFields: [],
				},
				{
					id: "highway/elevator",
					name: "Elevator",
					terms: [],
					icon: "temaki-elevator",
					geometry: ["vertex"],
					tags: { highway: "elevator" },
					fields: [],
					moreFields: [],
				},
			],
			[],
		);
		const graph = Graph.fromEntities([
			...square(1, 0, 0),
			way("w1", ring(1), { indoor: "room", amenity: "toilets" }),
			node("n5", { amenity: "toilets" }),
			node("n6", { highway: "elevator" }),
			node("n7", { highway: "elevator" }),
			way("w2", ["n7", nid(1, 1)], { indoor: "wall" }),
		]);
		const { collection } = buildFeatures(graph, {
			icons: new Set(["maki-toilet", "temaki-elevator", "highway_elevator"]),
			presets,
		});
		const icon = (id: string) =>
			collection.features.find((f) => f.properties["@id"] === id)?.properties[
				"@icon"
			];

		expect(icon("w1")).toBe("maki-toilet");
		expect(icon("n5")).toBe("maki-toilet");
		// A lone node is a point, which the elevator preset is not for: 1.x icon.
		expect(icon("n6")).toBe("highway_elevator");
		expect(icon("n7")).toBe("temaki-elevator");
	});

	it("marks every building outline, whatever it is drawn as", () => {
		const graph = Graph.fromEntities([
			...square(1, 0, 0),
			way("w1", ring(1), { building: "retail", shop: "mall" }),
			...square(2, 5, 5),
			way("w2", ring(2), { indoor: "room" }),
		]);
		const props = (id: string) =>
			buildFeatures(graph).collection.features.find(
				(f) => f.properties["@id"] === id,
			)?.properties;

		// A mall is drawn as an open space, but it is a building too.
		expect(props("w1")).toMatchObject({ "@kind": "space", "@building": "yes" });
		expect(props("w2")).not.toHaveProperty("@building");
	});

	it("skips ways whose nodes were not downloaded", () => {
		const entities = [
			node("n1"),
			way("w1", ["n1", "n2"], { highway: "corridor" }),
		];
		expect(featuresOf(entities).collection.features).toEqual([]);
	});

	it("lists the levels present in the data, including levels inside ranges", () => {
		const entities = [
			...square(1, 0, 0),
			way("w1", ring(1), { indoor: "area", level: "0-2" }),
			node("n5", { amenity: "toilets", level: "0.5" }),
			node("n6", { amenity: "toilets", level: "-1" }),
		];
		expect(featuresOf(entities).levels).toEqual([-1, 0, 0.5, 1, 2]);
	});

	it("draws a building on its building:levels without listing them", () => {
		const entities = [
			...square(1, 0, 0),
			way("w1", ring(1), { building: "yes", "building:levels": "25" }),
			node("n5", { amenity: "toilets", level: "0" }),
			node("n6", { amenity: "toilets", level: "1" }),
		];
		const { levels } = featuresOf(entities);
		expect(levels).toEqual([0, 1]);
		expect(feature(entities, "w1")?.properties["@lv"]).toBe(";0;1;");
	});

	it("draws a bare multipolygon (tags on its outer way) once, as that way", () => {
		const entities = [
			...square(1, 0, 0),
			way("w1", ring(1), { indoor: "room", level: "0" }),
			relation("r1", [{ ref: "w1", role: "outer" }], { type: "multipolygon" }),
		];
		const ids = featuresOf(entities).collection.features.map(
			(f) => f.properties["@id"],
		);
		expect(ids).toEqual(["w1"]);
	});

	it("puts a vertex without level on its ways' levels", () => {
		const entities = [
			...square(1, 0, 0),
			...square(2, 5, 0),
			node("n5", { door: "hinged" }, [0, -1]),
			way("w1", ["n11", "n5", "n12", "n13", "n14", "n11"], {
				indoor: "room",
				level: "1",
			}),
			way("w2", [...ring(2).slice(0, 2), "n5", ...ring(2).slice(2)], {
				indoor: "corridor",
				level: "2",
			}),
			// On the building outline only: still shown on every level.
			node("n6", { entrance: "main" }, [1, 1]),
			way("w3", ["n13", "n6", "n14"], {
				building: "yes",
				"building:levels": "3",
			}),
			node("n7", { door: "yes", level: "0" }, [-1, 0]),
			way("w4", ["n14", "n7", "n11"], { indoor: "wall", level: "1" }),
		];
		expect(feature(entities, "n5")?.properties["@lv"]).toBe(";1;2;");
		expect(feature(entities, "n6")?.properties["@lv"]).toBe("*");
		expect(feature(entities, "n7")?.properties["@lv"]).toBe(";0;");
	});
});

describe("levelFilter", () => {
	const entities = [
		...square(1, 0, 0),
		way("w1", ring(1), { building: "yes", "building:levels": "3" }),
		node("n5", { amenity: "toilets", level: "0;1" }),
		node("n6", { shop: "kiosk", level: "0.5" }),
		node("n7", { amenity: "bench" }),
	];
	const { collection } = featuresOf(entities);

	function visibleOn(level: number): string[] {
		const filter = featureFilter(levelFilter(level), "layers[0].filter");
		return collection.features
			.filter((f) =>
				filter.filter({ zoom: 18 }, { type: 1, properties: f.properties }),
			)
			.map((f) => String(f.properties["@id"]))
			.sort();
	}

	it("shows features listed on a level", () => {
		expect(visibleOn(1)).toEqual(["n5", "n7", "w1"]);
	});

	it("shows a range on the levels in between, but not a list", () => {
		expect(visibleOn(0.5)).toEqual(["n6", "n7", "w1"]);
	});

	it("shows features without level information on every level", () => {
		expect(visibleOn(-3)).toEqual(["n7"]);
	});

	it("treats level 0 as a real level", () => {
		expect(visibleOn(0)).toEqual(["n5", "n7", "w1"]);
	});
});
