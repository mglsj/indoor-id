import { describe, expect, it } from "vitest";
import type { Entity, NodeId } from "#lib/osm/entity.ts";
import { node, relation, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { diffFeatures, FeatureStore } from "./feature-store.ts";
import { buildFeatures, type IndoorFeature } from "./features.ts";

/** Node id n{prefix}{i}, e.g. n12. */
const nid = (prefix: number, i: number): NodeId => `n${prefix * 10 + i}`;

/** A square of nodes n{prefix}1..4 around (x, y). */
function square(prefix: number, x: number, y: number): Entity[] {
	return [
		node(nid(prefix, 1), {}, [x - 1, y - 1]),
		node(nid(prefix, 2), {}, [x + 1, y - 1]),
		node(nid(prefix, 3), {}, [x + 1, y + 1]),
		node(nid(prefix, 4), {}, [x - 1, y + 1]),
	];
}
const ring = (prefix: number) => [1, 2, 3, 4, 1].map((i) => nid(prefix, i));

const rooms = () =>
	Graph.fromEntities([
		...square(1, 0, 0),
		way("w1", ring(1), { indoor: "room", level: "0", name: "A" }),
		...square(2, 5, 0),
		way("w2", ring(2), { indoor: "room", level: "0-2" }),
	]);

const byId = (features: Iterable<IndoorFeature>) =>
	[...features].sort((a, b) =>
		a.properties["@id"].localeCompare(b.properties["@id"]),
	);

/** Updates the store, checking it gives what a full build of the graph gives. */
function update(store: FeatureStore, graph: Graph) {
	const features = store.update(graph);
	const full = buildFeatures(graph);
	expect(byId(features.byId.values())).toEqual(byId(full.collection.features));
	expect(features.levels).toEqual(full.levels);
	return features;
}

describe("FeatureStore: features rebuilt only for what changed", () => {
	it("keeps the features of entities left alone", () => {
		const store = new FeatureStore();
		const graph = rooms();
		const before = update(store, graph);
		const w2 = before.byId.get("w2");
		const after = update(
			store,
			graph.replace(
				way("w1", ring(1), { indoor: "room", level: "0", name: "B" }),
			),
		);
		expect(after.byId.get("w2")).toBe(w2);
		expect(after.byId.get("w1")?.properties.name).toBe("B");
	});

	it("redraws the ways and multipolygons using a moved node", () => {
		const store = new FeatureStore();
		const graph = rooms()
			.replace(way("w3", ring(2)))
			.replace(
				relation("r1", [{ ref: "w3", role: "outer" }], {
					type: "multipolygon",
					indoor: "area",
				}),
			);
		update(store, graph);
		const moved = update(store, graph.replace(node("n21", {}, [3, -2])));
		expect(moved.byId.get("w2")?.geometry).toMatchObject({
			coordinates: [expect.arrayContaining([[3, -2]])],
		});
		expect(JSON.stringify(moved.byId.get("r1")?.geometry)).toContain("[3,-2]");
	});

	it("gives a relation's level to its members without their own", () => {
		const store = new FeatureStore();
		const graph = rooms()
			.replace(way("w3", ring(2), { indoor: "corridor" }))
			.replace(
				relation("r1", [{ ref: "w3", role: "" }], {
					type: "level",
					level: "1",
				}),
			);
		update(store, graph);
		const retagged = update(
			store,
			graph.replace(
				relation("r1", [{ ref: "w3", role: "" }], {
					type: "level",
					level: "2",
				}),
			),
		);
		expect(retagged.byId.get("w3")?.properties["@lv"]).toBe(";2;");
	});

	it("follows a tagged node becoming a way's vertex, and features added or deleted", () => {
		const store = new FeatureStore();
		const graph = rooms().replace(node("n5", { door: "yes" }, [1, 0]));
		update(store, graph);
		const withWall = update(
			store,
			graph.replace(way("w4", ["n12", "n5", "n13"], { indoor: "wall" })),
		);
		expect(withWall.byId.has("w4")).toBe(true);
		const deleted = update(store, graph.remove("w1"));
		expect(deleted.byId.has("w1")).toBe(false);
		expect(deleted.byId.has("w4")).toBe(false);
	});

	it("encodes every feature's levels again when a new level appears", () => {
		const store = new FeatureStore();
		const graph = rooms();
		expect(update(store, graph).levels).toEqual([0, 1, 2]);
		const after = update(
			store,
			graph.replace(way("w1", ring(1), { indoor: "room", level: "1.5" })),
		);
		expect(after.levels).toEqual([0, 1, 1.5, 2]);
		// The range 0-2 now holds 1.5 too.
		expect(after.byId.get("w2")?.properties["@lv"]).toBe(";0;1;1.5;2;");
	});

	it("follows data downloaded under local edits", () => {
		const store = new FeatureStore();
		const edited = rooms().replace(
			way("w1", ring(1), { indoor: "room", level: "0", name: "B" }),
		);
		update(store, edited);
		const loaded = edited.rebaseOnto(
			edited.withBaseEntities([
				...square(3, 10, 0),
				way("w5", ring(3), { indoor: "room", level: "3" }),
			]),
		);
		expect(update(store, loaded).byId.has("w5")).toBe(true);
	});
});

describe("diffFeatures: what the map is sent", () => {
	const f = (id: string): IndoorFeature => ({
		type: "Feature",
		geometry: { type: "Point", coordinates: [0, 0] },
		properties: { "@id": id, "@lv": "*" },
	});

	it("adds new and changed features, removes those gone, and skips the same objects", () => {
		const [a, b, c] = [f("a"), f("b"), f("c")];
		const sent = new Map([
			["a", a],
			["b", b],
			["c", c],
		]);
		const b2 = f("b");
		const d = f("d");
		const next = new Map([
			["a", a],
			["b", b2],
			["d", d],
		]);
		expect(diffFeatures(sent, next)).toEqual({ add: [b2, d], remove: ["c"] });
		expect(diffFeatures(next, next)).toEqual({ add: [], remove: [] });
	});
});

describe("StoredFeatures.nodesNear: nodes to snap to, on the shown level", () => {
	const everywhere = { west: -100, south: -100, east: 100, north: 100 };
	const ids = (
		store: FeatureStore,
		graph: Graph,
		level: number,
		area = everywhere,
	) =>
		store
			.update(graph)
			.nodesNear(area, level)
			.map((n) => n.id)
			.sort();

	const graph = () =>
		rooms()
			// Without a level: on every level.
			.replace(node("n31", {}, [10, 10]))
			.replace(node("n32", {}, [11, 10]))
			.replace(way("w3", ["n31", "n32"], { indoor: "wall" }))
			// A tagged node on level 1, and a node no feature draws.
			.replace(node("n41", { door: "yes", level: "1" }, [20, 20]))
			.replace(node("n42", {}, [21, 21]));

	it("gives the nodes of the features drawn on the level", () => {
		const store = new FeatureStore();
		expect(ids(store, graph(), 0)).toEqual(
			[
				"n11",
				"n12",
				"n13",
				"n14",
				"n21",
				"n22",
				"n23",
				"n24",
				"n31",
				"n32",
			].sort(),
		);
		// w2 is on levels 0 to 2, w1 on 0 only.
		expect(ids(store, graph(), 1)).toEqual(
			["n21", "n22", "n23", "n24", "n31", "n32", "n41"].sort(),
		);
	});

	it("only those in the area, once each, with their position", () => {
		const store = new FeatureStore();
		const near = store
			.update(graph())
			.nodesNear({ west: 0.5, south: 0.5, east: 1.5, north: 1.5 }, 0);
		expect(near).toEqual([{ id: "n13", loc: [1, 1] }]);
	});

	it("follows edits: a moved node, a way moved to another level", () => {
		const store = new FeatureStore();
		const start = graph();
		ids(store, start, 0);
		const moved = start.replace(node("n13", {}, [50, 50]));
		expect(
			store
				.update(moved)
				.nodesNear({ west: 49, south: 49, east: 51, north: 51 }, 0),
		).toEqual([{ id: "n13", loc: [50, 50] }]);
		const relevelled = moved.replace(
			way("w1", ring(1), { indoor: "room", level: "3" }),
		);
		expect(ids(store, relevelled, 0)).toEqual(
			["n21", "n22", "n23", "n24", "n31", "n32"].sort(),
		);
		expect(ids(store, relevelled, 3)).toEqual(
			["n11", "n12", "n13", "n14", "n31", "n32"].sort(),
		);
	});
});

describe("FeatureStore without levels", () => {
	it("draws data where nothing has a level, built whole or changed", () => {
		const store = new FeatureStore();
		const graph = Graph.fromEntities([
			...square(1, 0, 0),
			way("w1", ring(1), { indoor: "room" }),
		]);
		expect(update(store, graph).byId.get("w1")?.properties["@lv"]).toBe("*");
		const empty = new FeatureStore();
		update(empty, Graph.fromEntities([]));
		expect(update(empty, graph).byId.has("w1")).toBe(true);
	});
});

describe("FeatureStore: the levels in view", () => {
	const everywhere = { west: -100, south: -100, east: 100, north: 100 };
	const levels = (
		graph: Graph,
		extent = everywhere,
		store = new FeatureStore(),
	) => store.update(graph).levelsIn(extent);

	it("lists the levels of the features in view only", () => {
		const graph = Graph.fromEntities([
			...square(1, 0, 0),
			way("w1", ring(1), { indoor: "room", level: "0" }),
			...square(2, 50, 0),
			way("w2", ring(2), { indoor: "room", level: "4" }),
		]);
		expect(levels(graph).map((e) => e.level)).toEqual([0, 1, 2, 3, 4]);
		expect(
			levels(graph, { west: -2, south: -2, east: 2, north: 2 }).map(
				(e) => e.level,
			),
		).toEqual([0]);
		// Nothing on a level in view: no list.
		expect(levels(graph, { west: 20, south: 20, east: 30, north: 30 })).toEqual(
			[],
		);
	});

	it("doesn't list a building's building:levels, nor a building alone", () => {
		const graph = Graph.fromEntities([
			...square(1, 0, 0),
			way("w1", ring(1), { building: "yes", "building:levels": "25" }),
		]);
		expect(levels(graph)).toEqual([]);
	});

	it("names levels from indoor=level outlines, then building:levels:ref", () => {
		const graph = Graph.fromEntities([
			...square(1, 0, 0),
			way("w1", ring(1), {
				building: "yes",
				"building:levels": "2",
				"building:levels:underground": "1",
				"building:levels:ref": "UG;EG;OG",
			}),
			...square(2, 0, 0.5),
			way("w2", ring(2), {
				indoor: "level",
				level: "0",
				"level:ref": "E0",
				name: "Erdgeschoss",
			}),
			...square(3, 0, -0.5),
			way("w3", ring(3), { indoor: "room", level: "-1" }),
		]);
		expect(levels(graph)).toEqual([
			{ level: -1, ref: "UG" },
			{ level: 0, ref: "E0", name: "Erdgeschoss" },
		]);
	});

	it("takes the names of the building nearest the middle of the view", () => {
		const building = (prefix: number, x: number, ref: string) => [
			...square(prefix, x, 0),
			way(`w${prefix}`, ring(prefix), {
				building: "yes",
				"building:levels:ref:equivalent": `${ref}=level 0`,
			}),
			...square(prefix + 1, x, 0),
			way(`w${prefix + 1}`, ring(prefix + 1), { indoor: "room", level: "0" }),
		];
		const graph = Graph.fromEntities([
			...building(1, 0, "A"),
			...building(3, 10, "B"),
		]);
		const view = (x: number) => ({
			west: x - 12,
			south: -5,
			east: x + 12,
			north: 5,
		});
		expect(levels(graph, view(1))).toEqual([{ level: 0, ref: "A" }]);
		expect(levels(graph, view(9))).toEqual([{ level: 0, ref: "B" }]);
	});

	it("skips a building's non-existent levels", () => {
		const graph = Graph.fromEntities([
			...square(1, 0, 0),
			way("w1", ring(1), { building: "yes", non_existent_levels: "13" }),
			...square(2, 0, 0),
			way("w2", ring(2), {
				indoor: "room",
				highway: "elevator",
				level: "12-14",
			}),
		]);
		expect(levels(graph).map((e) => e.level)).toEqual([12, 14]);
	});

	it("follows edits", () => {
		const store = new FeatureStore();
		const graph = Graph.fromEntities([
			...square(1, 0, 0),
			way("w1", ring(1), { indoor: "room", level: "0" }),
		]);
		expect(levels(graph, everywhere, store)).toEqual([{ level: 0 }]);
		const named = graph.replace(
			way("w1", ring(1), { indoor: "level", level: "1", "level:ref": "M" }),
		);
		expect(levels(named, everywhere, store)).toEqual([{ level: 1, ref: "M" }]);
		const moved = named.replace(node(nid(1, 1), {}, [80, 80]));
		expect(
			levels(moved, { west: 70, south: 70, east: 90, north: 90 }, store),
		).toEqual([{ level: 1, ref: "M" }]);
	});
});
