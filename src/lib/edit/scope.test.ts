import { describe, expect, it } from "vitest";
import type { Entity, Loc, NodeId } from "#lib/osm/entity.ts";
import { node, relation, way } from "#lib/osm/fixtures.ts";
import { fromLocal } from "#lib/osm/geometry.ts";
import { Graph } from "#lib/osm/graph.ts";
import type { Tags } from "#lib/osm/tags.ts";
import { inScope, isMapFeature, scopeAt, scopeFor, scopeOf } from "./scope.ts";

const ORIGIN: Loc = [13.4, 52.5];
/** A position `east` and `north` metres from the origin. */
const at = (east: number, north: number): Loc =>
	fromLocal(ORIGIN, [east, north]);

/**
 * Two buildings side by side sharing a wall: A from x 0 to 20, B from x 20 to 40, both 10 m
 * deep. A's corners n1–n4, B's n2, n5, n6, n3 (n2 and n3 shared).
 */
function street(extra: Entity[] = []): Graph {
	return Graph.fromEntities([
		node("n1", {}, at(0, 0)),
		node("n2", {}, at(20, 0)),
		node("n3", {}, at(20, 10)),
		node("n4", {}, at(0, 10)),
		node("n5", {}, at(40, 0)),
		node("n6", {}, at(40, 10)),
		way("w1", ["n1", "n2", "n3", "n4", "n1"], { building: "yes" }),
		way("w2", ["n2", "n5", "n6", "n3", "n2"], { building: "yes" }),
		...extra,
	]);
}

/** A closed way through new nodes at the given positions (ids from `first` up). */
function ring(
	id: `w${number}`,
	first: number,
	corners: Loc[],
	tags: Tags,
): Entity[] {
	const nodes = corners.map((loc, i) => node(`n${first + i}`, {}, loc));
	const ids = nodes.map((n) => n.id);
	return [...nodes, way(id, [...ids, ids[0] as NodeId], tags)];
}

const room = (id: `w${number}`, first: number, corners: Loc[]) =>
	ring(id, first, corners, { indoor: "room", level: "0" });

describe("scopeOf: what can be entered", () => {
	it("enters a building way, with its ring", () => {
		const scope = scopeOf(street(), "w1");
		expect(scope?.id).toBe("w1");
		expect(scope?.kind).toBe("building");
		expect(scope?.rings).toHaveLength(1);
	});

	it("enters a building multipolygon by its outer rings", () => {
		const graph = street([
			relation("r1", [{ ref: "w9", role: "outer" }], {
				type: "multipolygon",
				building: "yes",
			}),
			...ring("w9", 100, [at(0, 20), at(10, 20), at(10, 30), at(0, 30)], {}),
		]);
		const scope = scopeOf(graph, "r1");
		expect(scope?.kind).toBe("building");
		expect(scope?.rings).toHaveLength(1);
	});

	it("enters a type=building relation by its outline", () => {
		const graph = street([
			relation(
				"r2",
				[
					{ ref: "w1", role: "outline" },
					{ ref: "w2", role: "part" },
				],
				{ type: "building" },
			),
		]);
		const scope = scopeOf(graph, "r2");
		expect(scope?.kind).toBe("building");
		expect(scope?.rings).toHaveLength(1);
	});

	it("enters an indoor=level outline when there is no building", () => {
		const graph = Graph.fromEntities(
			ring("w9", 100, [at(0, 0), at(10, 0), at(10, 10), at(0, 10)], {
				indoor: "level",
				level: "0",
			}),
		);
		expect(scopeOf(graph, "w9")?.kind).toBe("level");
	});

	it("refuses rooms, open ways, points and what isn't loaded", () => {
		const graph = street([
			...room("w9", 100, [at(1, 1), at(5, 1), at(5, 5), at(1, 5)]),
			way("w8", ["n1", "n2"], { building: "yes" }),
		]);
		expect(scopeOf(graph, "w9")).toBeNull();
		expect(scopeOf(graph, "w8")).toBeNull();
		expect(scopeOf(graph, "n1")).toBeNull();
		expect(scopeOf(graph, "w404")).toBeNull();
	});
});

describe("inScope: what belongs to the building entered", () => {
	const graph = street([
		// In A.
		...room("w10", 100, [at(1, 1), at(9, 1), at(9, 9), at(1, 9)]),
		// In B, against the shared wall: its corners n2 and n3 are A's too.
		way("w11", ["n2", "n200", "n201", "n3", "n2"], {
			indoor: "room",
			level: "0",
		}),
		node("n200", {}, at(30, 0)),
		node("n201", {}, at(30, 10)),
		// Across the shared wall, a corridor in both buildings.
		...room("w12", 300, [at(15, 4), at(25, 4), at(25, 6), at(15, 6)]),
		// A level outline along A's walls, through A's own corners.
		way("w13", ["n1", "n2", "n3", "n4", "n1"], { indoor: "level", level: "0" }),
		// A door on the shared wall, an entrance on A's facade, a shop inside A.
		node("n400", { door: "yes" }, at(20, 5)),
		node("n401", { entrance: "yes" }, at(10, 0)),
		node("n402", { shop: "bakery", level: "0" }, at(5, 5)),
		// A building part inside A, with no type=building relation.
		...ring("w14", 500, [at(2, 2), at(6, 2), at(6, 6), at(2, 6)], {
			"building:part": "yes",
		}),
		// A multipolygon room in A.
		relation("r1", [{ ref: "w15", role: "outer" }], {
			type: "multipolygon",
			indoor: "room",
			level: "1",
		}),
		...ring("w15", 600, [at(11, 1), at(19, 1), at(19, 9), at(11, 9)], {}),
	]);
	const a = scopeOf(graph, "w1");
	const b = scopeOf(graph, "w2");
	if (!a || !b) throw new Error("the buildings should be scopes");

	it("holds its own outline and its corners", () => {
		expect(inScope(graph, a, "w1")).toBe(true);
		expect(inScope(graph, a, "n1")).toBe(true);
	});

	it("holds the rooms inside, not the neighbour's against a shared wall", () => {
		expect(inScope(graph, a, "w10")).toBe(true);
		expect(inScope(graph, a, "w11")).toBe(false);
		expect(inScope(graph, b, "w11")).toBe(true);
		expect(inScope(graph, b, "w10")).toBe(false);
	});

	it("leaves out the neighbouring building", () => {
		expect(inScope(graph, a, "w2")).toBe(false);
		expect(inScope(graph, b, "w1")).toBe(false);
	});

	it("puts a space across two buildings in both", () => {
		expect(inScope(graph, a, "w12")).toBe(true);
		expect(inScope(graph, b, "w12")).toBe(true);
	});

	it("holds a level outline that runs along the walls", () => {
		expect(inScope(graph, a, "w13")).toBe(true);
	});

	it("holds points inside and on the walls", () => {
		expect(inScope(graph, a, "n402")).toBe(true);
		expect(inScope(graph, a, "n401")).toBe(true);
		// On the shared wall: in both.
		expect(inScope(graph, a, "n400")).toBe(true);
		expect(inScope(graph, b, "n400")).toBe(true);
		expect(inScope(graph, b, "n402")).toBe(false);
	});

	it("holds building parts inside without a relation", () => {
		expect(inScope(graph, a, "w14")).toBe(true);
	});

	it("holds a multipolygon by its members", () => {
		expect(inScope(graph, a, "r1")).toBe(true);
		expect(inScope(graph, b, "r1")).toBe(false);
	});

	it("leaves out what isn't loaded", () => {
		expect(inScope(graph, a, "w404")).toBe(false);
	});
});

describe("scopeAt: what 'Edit indoor here' enters", () => {
	it("picks the building under the point", () => {
		expect(scopeAt(street(), at(30, 5))?.id).toBe("w2");
	});

	it("picks the smallest building when they nest", () => {
		const graph = street(
			ring("w9", 100, [at(2, 2), at(8, 2), at(8, 8), at(2, 8)], {
				building: "yes",
			}),
		);
		expect(scopeAt(graph, at(5, 5))?.id).toBe("w9");
	});

	it("picks the multipolygon, not its untagged outer way", () => {
		const graph = Graph.fromEntities([
			relation("r1", [{ ref: "w9", role: "outer" }], {
				type: "multipolygon",
				building: "yes",
			}),
			...ring("w9", 100, [at(0, 0), at(10, 0), at(10, 10), at(0, 10)], {}),
		]);
		expect(scopeAt(graph, at(5, 5))?.id).toBe("r1");
	});

	it("falls back to a level outline outside any building", () => {
		const graph = Graph.fromEntities(
			ring("w9", 100, [at(50, 0), at(60, 0), at(60, 10), at(50, 10)], {
				indoor: "level",
				level: "-1",
			}),
		);
		expect(scopeAt(graph, at(55, 5))?.id).toBe("w9");
	});

	it("finds nothing on the open map", () => {
		expect(scopeAt(street(), at(100, 100))).toBeNull();
	});
});

describe("scopeFor: the building a click on an indoor feature enters", () => {
	const graph = street([
		...room("w10", 100, [at(1, 1), at(9, 1), at(9, 9), at(1, 9)]),
		node("n402", { shop: "bakery", level: "0" }, at(35, 5)),
		...room("w12", 300, [at(60, 0), at(70, 0), at(70, 10), at(60, 10)]),
	]);

	it("finds the building around a room or a point", () => {
		expect(scopeFor(graph, "w10")?.id).toBe("w1");
		expect(scopeFor(graph, "n402")?.id).toBe("w2");
	});

	it("finds none for indoor data outside any building", () => {
		expect(scopeFor(graph, "w12")).toBeNull();
	});
});

describe("Scope.ways: the outline locked in building mode", () => {
	it("lists the outer ways entered", () => {
		expect(scopeOf(street(), "w1")?.ways).toEqual(["w1"]);
	});
});

describe("isMapFeature: what map mode picks", () => {
	it("picks buildings, parts and entrances, not indoor features", () => {
		expect(isMapFeature({ "@kind": "building", building: "yes" })).toBe(true);
		expect(isMapFeature({ "@kind": "door", entrance: "main" })).toBe(true);
		expect(isMapFeature({ "@kind": "door", door: "yes" })).toBe(false);
		expect(isMapFeature({ "@kind": "room", indoor: "room" })).toBe(false);
	});
});
