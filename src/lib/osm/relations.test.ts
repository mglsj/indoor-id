import { describe, expect, it } from "vitest";
import type { Relation } from "./entity.ts";
import { node, relation, way } from "./fixtures.ts";
import { Graph } from "./graph.ts";
import {
	entityExtent,
	isComplete,
	memberRows,
	memberships,
	nearbyRelations,
	relationIdIn,
} from "./relations.ts";

/** "Preset name", then the name, as iD's `baseDisplayValue`. */
const label = (r: Relation) =>
	`${r.tags.type === "multipolygon" ? "Multipolygon" : "Relation"} ${r.tags.name ?? ""}`;

describe("memberships: the Relations section's rows", () => {
	const graph = Graph.fromEntities([
		node("n1"),
		way("w1", ["n1"]),
		relation("r1", [{ ref: "w1", role: "outer" }], { type: "site", name: "B" }),
		relation(
			"r2",
			[
				{ ref: "w1", role: "a" },
				{ ref: "n1", role: "" },
				{ ref: "w1", role: "b" },
			],
			{ type: "site", name: "A" },
		),
		relation("r3", [{ ref: "w1", role: "" }], { type: "site", name: "A" }),
	]);

	it("has a row per membership, sorted by label then id", () => {
		expect(
			memberships(graph, "w1", label).map((m) => [
				m.relation.id,
				m.index,
				m.role,
			]),
		).toEqual([
			["r2", 0, "a"],
			["r2", 2, "b"],
			["r3", 0, ""],
			["r1", 0, "outer"],
		]);
	});

	it("puts the relations just added last, in the order they were added", () => {
		expect(
			memberships(graph, "w1", label, ["r3", "r2"]).map((m) => m.relation.id),
		).toEqual(["r1", "r3", "r2", "r2"]);
	});

	it("is empty for a feature in no relation", () => {
		expect(memberships(graph, "r1", label)).toEqual([]);
	});
});

describe("memberRows: the Members section's rows", () => {
	it("lists the members in order, with the entity when it is loaded", () => {
		const graph = Graph.fromEntities([
			node("n1"),
			relation("r1", [
				{ ref: "n1", role: "label" },
				{ ref: "w9", role: "outer" },
			]),
		]);
		const rows = memberRows(graph, graph.entity("r1") as Relation);
		expect(rows).toEqual([
			{ index: 0, ref: "n1", role: "label", entity: graph.entity("n1") },
			{ index: 1, ref: "w9", role: "outer", entity: undefined },
		]);
		expect(isComplete(graph, graph.entity("r1") as Relation)).toBe(false);
	});
});

describe("relationIdIn: a relation typed by its id", () => {
	it("reads r123, 123, relation/123 and a link to it", () => {
		expect(relationIdIn("r123")).toBe("r123");
		expect(relationIdIn("123")).toBe("r123");
		expect(relationIdIn(" relation/123 ")).toBe("r123");
		expect(relationIdIn("https://www.openstreetmap.org/relation/123")).toBe(
			"r123",
		);
		expect(relationIdIn("r-2")).toBe("r-2");
	});

	it("reads nothing else", () => {
		expect(relationIdIn("")).toBeNull();
		expect(relationIdIn("library")).toBeNull();
		expect(relationIdIn("w123")).toBeNull();
	});
});

describe("nearbyRelations: the relations a feature can be added to", () => {
	const entities = [
		node("n1"),
		node("n2"),
		node("n3"),
		way("w1", ["n1", "n2"]),
		way("w2", ["n2", "n3"]),
		relation("r10", [{ ref: "n3", role: "" }], { type: "site", name: "Old" }),
		relation("r20", [{ ref: "n3", role: "" }], { type: "site", name: "New" }),
		// Connected: holds w2, which shares n2 with w1.
		relation("r5", [{ ref: "w2", role: "" }], { type: "site", name: "Hall" }),
		relation("r30", [{ ref: "n3", role: "" }], { type: "site", name: "New" }),
		relation("r40", [{ ref: "n3", role: "" }], { type: "site", name: "Far" }),
	];
	const graph = Graph.fromEntities(entities).replace({
		type: "relation",
		id: "r-1",
		tags: {},
		members: [{ ref: "n3", role: "" }],
	});
	const inView = (r: Relation) => r.id !== "r40";
	const ids = (query: string, id: "w1" | "r10" = "w1") =>
		nearbyRelations(graph, id, query, { inView, label }).map((c) => [
			c.relation.id,
			c.value,
		]);

	it("lists those in view, connected ones first, then the newest", () => {
		expect(ids("")).toEqual([
			["r5", "Relation Hall"],
			["r-1", "Relation "],
			["r30", "Relation New r30"],
			["r20", "Relation New r20"],
			["r10", "Relation Old"],
		]);
	});

	it("filters by label and id, and leaves out the feature itself", () => {
		expect(ids("new")).toEqual([
			["r30", "Relation New r30"],
			["r20", "Relation New r20"],
		]);
		expect(ids("r1", "r10").map(([id]) => id)).toEqual([]);
		expect(ids("hall").map(([id]) => id)).toEqual(["r5"]);
	});

	it("finds a loaded relation by its id, even out of view", () => {
		expect(ids("r40")).toEqual([["r40", "Relation Far r40"]]);
		expect(ids("40")).toEqual([["r40", "Relation Far r40"]]);
	});
});

describe("entityExtent", () => {
	const graph = Graph.fromEntities([
		node("n1", {}, [1, 2]),
		node("n2", {}, [3, 5]),
		node("n3", {}, [-1, 4]),
		way("w1", ["n1", "n2"]),
		relation("r1", [
			{ ref: "w1", role: "" },
			{ ref: "n3", role: "" },
			{ ref: "w9", role: "" },
			{ ref: "r2", role: "" },
		]),
		// Relations can hold each other.
		relation("r2", [{ ref: "r1", role: "" }]),
	]);

	it("covers a node, a way and the loaded members of a relation", () => {
		expect(entityExtent(graph, "n1")).toEqual({
			west: 1,
			south: 2,
			east: 1,
			north: 2,
		});
		expect(entityExtent(graph, "w1")).toEqual({
			west: 1,
			south: 2,
			east: 3,
			north: 5,
		});
		expect(entityExtent(graph, "r1")).toEqual({
			west: -1,
			south: 2,
			east: 3,
			north: 5,
		});
		expect(entityExtent(graph, "r2")).toEqual(entityExtent(graph, "r1"));
	});

	it("is null when nothing of it is loaded", () => {
		expect(entityExtent(graph, "w9")).toBeNull();
	});
});
