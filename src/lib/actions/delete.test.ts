import { describe, expect, it } from "vitest";
import type { EntityId } from "#lib/osm/entity.ts";
import { node, relation, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { deleteEntities } from "./delete.ts";

const ids = (entities: readonly { id: EntityId }[]) =>
	entities.map((e) => e.id).sort();

describe("deleteEntities", () => {
	describe("a way", () => {
		it("also deletes its untagged nodes", () => {
			const graph = Graph.fromEntities([
				node("n1"),
				node("n2"),
				way("w1", ["n1", "n2"]),
			]);
			const after = deleteEntities(["w1"])(graph);
			expect(ids(after.changes().deleted)).toEqual(["n1", "n2", "w1"]);
		});

		it("keeps nodes that have tags (POIs, doors)", () => {
			const graph = Graph.fromEntities([
				node("n1"),
				node("n2", { door: "hinged" }),
				way("w1", ["n1", "n2"]),
			]);
			const after = deleteEntities(["w1"])(graph);
			expect(ids(after.changes().deleted)).toEqual(["n1", "w1"]);
		});

		it("keeps nodes still used by another way", () => {
			const graph = Graph.fromEntities([
				node("n1"),
				node("n2"),
				node("n3"),
				way("w1", ["n1", "n2"]),
				way("w2", ["n2", "n3"]),
			]);
			const after = deleteEntities(["w1"])(graph);
			expect(ids(after.changes().deleted)).toEqual(["n1", "w1"]);
		});

		it("keeps nodes that are relation members", () => {
			const graph = Graph.fromEntities([
				node("n1"),
				node("n2"),
				way("w1", ["n1", "n2"]),
				relation("r1", [
					{ ref: "n2", role: "label" },
					{ ref: "w9", role: "outer" },
				]),
			]);
			const after = deleteEntities(["w1"])(graph);
			expect(ids(after.changes().deleted)).toEqual(["n1", "w1"]);
		});

		it("is removed from its relations, and relations left empty are deleted", () => {
			const graph = Graph.fromEntities([
				node("n1"),
				node("n2"),
				node("n3"),
				way("w1", ["n1", "n2"]),
				way("w2", ["n2", "n3"]),
				relation("r1", [{ ref: "w1", role: "outer" }]),
				relation("r2", [
					{ ref: "w1", role: "outer" },
					{ ref: "w2", role: "inner" },
				]),
				relation("r3", [{ ref: "r1", role: "" }], { type: "site" }),
			]);
			const after = deleteEntities(["w1"])(graph);

			expect(after.entity("r2")).toMatchObject({
				members: [{ ref: "w2", role: "inner" }],
			});
			expect(ids(after.changes().deleted)).toEqual(["n1", "r1", "r3", "w1"]);
		});
	});

	describe("a relation", () => {
		it("takes the members left untagged and unused with it (iD's actionDeleteRelation)", () => {
			const graph = Graph.fromEntities([
				node("n1"),
				node("n2"),
				node("n3"),
				node("n4", { door: "yes" }),
				way("w1", ["n1", "n2", "n3", "n1"]),
				way("w2", ["n1", "n4"], { indoor: "wall" }),
				way("w3", ["n2", "n3"]),
				relation(
					"r1",
					[
						{ ref: "w1", role: "outer" },
						{ ref: "w2", role: "" },
						{ ref: "w3", role: "inner" },
						{ ref: "n4", role: "" },
					],
					{ type: "multipolygon", indoor: "room" },
				),
				relation("r2", [{ ref: "w3", role: "" }], { type: "site" }),
			]);
			const after = deleteEntities(["r1"])(graph);
			// w1 goes with its untagged nodes not used elsewhere (n3 stays: w3 uses it); the
			// tagged wall and door stay, and so does w3, still in r2.
			expect(ids(after.changes().deleted)).toEqual(["r1", "w1"]);
			expect(after.entity("w2")).toBeDefined();
			expect(after.entity("w3")).toBeDefined();
			expect(after.entity("n1")).toBeDefined();
		});
	});

	describe("a node", () => {
		it("is removed from its ways", () => {
			const graph = Graph.fromEntities([
				node("n1"),
				node("n2"),
				node("n3"),
				way("w1", ["n1", "n2", "n3"]),
			]);
			const after = deleteEntities(["n2"])(graph);
			expect(after.entity("w1")).toMatchObject({ nodes: ["n1", "n3"] });
		});

		it("deletes a line left with a single node", () => {
			const graph = Graph.fromEntities([
				node("n1"),
				node("n2"),
				way("w1", ["n1", "n2"]),
			]);
			const after = deleteEntities(["n2"])(graph);
			expect(ids(after.changes().deleted)).toEqual(["n1", "n2", "w1"]);
		});

		it("deletes an area left with fewer than three corners", () => {
			const graph = Graph.fromEntities([
				node("n1"),
				node("n2"),
				node("n3"),
				way("w1", ["n1", "n2", "n3", "n1"], { indoor: "room" }),
			]);
			const after = deleteEntities(["n3"])(graph);
			expect(ids(after.changes().deleted)).toEqual(["n1", "n2", "n3", "w1"]);
		});

		it("keeps an area closed when its first node is deleted", () => {
			const graph = Graph.fromEntities([
				node("n1"),
				node("n2"),
				node("n3"),
				node("n4"),
				way("w1", ["n1", "n2", "n3", "n4", "n1"]),
			]);
			const after = deleteEntities(["n1"])(graph);
			expect(after.entity("w1")).toMatchObject({
				nodes: ["n2", "n3", "n4", "n2"],
			});
		});
	});

	it("forgets entities created locally instead of listing them as deleted", () => {
		const graph = Graph.fromEntities([node("n1")]).replace({
			type: "node",
			id: "n-1",
			tags: {},
			loc: [0, 0],
		});
		const after = deleteEntities(["n-1"])(graph);
		expect(after.entity("n-1")).toBeUndefined();
		expect(after.hasChanges()).toBe(false);
	});

	it("leaves the original graph unchanged", () => {
		const graph = Graph.fromEntities([
			node("n1"),
			node("n2"),
			way("w1", ["n1", "n2"]),
		]);
		deleteEntities(["w1"])(graph);
		expect(graph.hasChanges()).toBe(false);
		expect(graph.entity("w1")).toBeDefined();
	});
});
