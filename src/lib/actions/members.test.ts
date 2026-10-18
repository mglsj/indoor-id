import { describe, expect, it } from "vitest";
import type { Relation, RelationId } from "#lib/osm/entity.ts";
import { node, relation, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import {
	addMember,
	addToNewRelation,
	changeMemberRoles,
	moveMember,
	removeMembers,
} from "./members.ts";

const base = () =>
	Graph.fromEntities([
		node("n1"),
		node("n2"),
		node("n3"),
		way("w1", ["n1", "n2", "n3", "n1"], { indoor: "room" }),
		way("w2", ["n1", "n2"]),
		relation(
			"r1",
			[
				{ ref: "w1", role: "outer" },
				{ ref: "w2", role: "inner" },
				{ ref: "w1", role: "" },
			],
			{ type: "multipolygon", indoor: "room" },
		),
		relation("r2", [{ ref: "r1", role: "" }], { type: "site" }),
	]);

const members = (graph: Graph, id: RelationId) =>
	(graph.entity(id) as Relation).members;

describe("addMember", () => {
	it("adds the member at the end, whatever its type", () => {
		const graph = addMember("r2", { ref: "w2", role: "entrance" })(base());
		expect(members(graph, "r2")).toEqual([
			{ ref: "r1", role: "" },
			{ ref: "w2", role: "entrance" },
		]);
	});
});

describe("addToNewRelation", () => {
	it("creates an untagged relation with the member", () => {
		const graph = base();
		const id = graph.newId("relation");
		const next = addToNewRelation(id, { ref: "w1", role: "outer" })(graph);
		expect(next.entity(id)).toEqual({
			type: "relation",
			id,
			tags: {},
			members: [{ ref: "w1", role: "outer" }],
		});
		expect(next.parentRelations("w1").map((r) => r.id)).toContain(id);
	});
});

describe("changeMemberRoles", () => {
	it("sets the role of the members at the indexes", () => {
		const graph = changeMemberRoles("r1", [0, 2], "inner")(base());
		expect(members(graph, "r1")).toEqual([
			{ ref: "w1", role: "inner" },
			{ ref: "w2", role: "inner" },
			{ ref: "w1", role: "inner" },
		]);
	});

	it("can empty a role", () => {
		const graph = changeMemberRoles("r1", [1], "")(base());
		expect(members(graph, "r1")[1]).toEqual({ ref: "w2", role: "" });
	});
});

describe("removeMembers", () => {
	it("removes the members at the indexes, whatever their order", () => {
		const graph = removeMembers("r1", [0, 2])(base());
		expect(members(graph, "r1")).toEqual([{ ref: "w2", role: "inner" }]);
		// The way is still there: only its membership went.
		expect(graph.entity("w1")).toBeDefined();
	});

	it("deletes the relation once its last member goes, and takes it out of its parents", () => {
		const graph = removeMembers("r2", [0])(base());
		expect(graph.entity("r2")).toBeUndefined();
		expect(graph.entity("r1")).toBeDefined();

		const emptied = removeMembers("r1", [2, 1, 0])(base());
		expect(emptied.entity("r1")).toBeUndefined();
		// r2 only held r1: it goes too, as in iD.
		expect(emptied.entity("r2")).toBeUndefined();
	});
});

describe("moveMember", () => {
	it("moves a member to another place", () => {
		const graph = moveMember("r1", 2, 0)(base());
		expect(members(graph, "r1")).toEqual([
			{ ref: "w1", role: "" },
			{ ref: "w1", role: "outer" },
			{ ref: "w2", role: "inner" },
		]);
		const down = moveMember("r1", 0, 1)(base());
		expect(members(down, "r1").map((m) => m.role)).toEqual([
			"inner",
			"outer",
			"",
		]);
	});
});
