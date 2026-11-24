import { describe, expect, it } from "vitest";
import type { Entity, EntityId } from "#lib/osm/entity.ts";
import { node, relation, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import {
	type Current,
	idsToCheck,
	mergeMembers,
	mergeTags,
	missingChildren,
	rebase,
	resolveConflict,
} from "./rebase.ts";

/** The server's version 2 of an entity (`null`: deleted), by `user`. */
function v2(entity: Entity | null, id?: EntityId, user = "Ana"): Current {
	const theirs = entity && { ...entity, version: 2 };
	return {
		id: id ?? (entity as Entity).id,
		version: 2,
		entity: theirs,
		user,
	};
}

/** A room: way w1 on nodes n1–n3, downloaded at version 1. */
const ROOM = [
	node("n1", {}, [0, 0]),
	node("n2", {}, [1, 0]),
	node("n3", {}, [1, 1]),
	way("w1", ["n1", "n2", "n3", "n1"], { indoor: "room", level: "0" }),
];

/** The room's graph after `edit`, and the rebase's result applied to its history step. */
function edited(edit: (g: Graph) => Graph, entities: Entity[] = ROOM) {
	const graph = edit(Graph.fromEntities(entities));
	const apply = (result: ReturnType<typeof rebase>) =>
		result.action(
			graph.rebaseOnto(
				graph.base().withBaseEntities(result.server, result.gone),
			),
		);
	return { graph, apply };
}

describe("idsToCheck: what an upload fetches first", () => {
	it("lists modified and deleted entities and the nodes uploaded ways use", () => {
		const { graph } = edited((g) =>
			g
				.replace({ ...way("w1", ["n1", "n2", "n3", "n1"]), tags: { ref: "1" } })
				.replace(node("n-1"))
				.replace(way("w-1", ["n-1", "n2"]))
				.remove("n3"),
		);
		expect(idsToCheck(graph).sort()).toEqual(["n1", "n2", "n3", "w1"]);
	});

	it("lists nothing new and nothing unchanged", () => {
		const { graph } = edited((g) => g.replace(node("n-1")));
		expect(idsToCheck(graph)).toEqual([]);
	});
});

describe("mergeTags", () => {
	it("takes each key from the side that changed it", () => {
		expect(
			mergeTags(
				{ indoor: "room", ref: "1", name: "Lab" },
				{ indoor: "room", ref: "B12", name: "Lab" },
				{ indoor: "room", ref: "1", level: "0" },
			),
		).toEqual({
			merged: { indoor: "room", ref: "B12", level: "0" },
			conflicts: [],
		});
	});

	it("reports keys both changed differently, not those both changed alike", () => {
		expect(
			mergeTags(
				{ ref: "1", name: "Lab" },
				{ ref: "2", name: "Office" },
				{ ref: "3", name: "Office" },
			).conflicts,
		).toEqual(["ref"]);
	});
});

describe("mergeMembers", () => {
	const a = { ref: "w1", role: "outer" } as const;
	const b = { ref: "w2", role: "inner" } as const;
	const c = { ref: "w3", role: "inner" } as const;
	const d = { ref: "w4", role: "inner" } as const;

	it("keeps the members both sides added and drops those removed", () => {
		expect(mergeMembers([a, b], [a, b, c], [a, b, d])).toEqual([a, b, d, c]);
		expect(mergeMembers([a, b, c], [a, c], [a, b, c, d])).toEqual([a, c, d]);
	});

	it("can't merge a reorder with another change", () => {
		expect(mergeMembers([a, b, c], [c, b, a], [a, b, c, d])).toBeUndefined();
	});
});

describe("rebase: the edits moved onto the server's current versions", () => {
	it("skips what the server has in the version downloaded", () => {
		const { graph } = edited((g) =>
			g.replace({ ...way("w1", ["n1", "n2", "n3", "n1"]), tags: {} }),
		);
		const result = rebase(graph, [
			{ id: "w1", version: 1, entity: way("w1", []) },
		]);
		expect(result).toMatchObject({ server: [], gone: [], merged: 0 });
		expect(result.conflicts).toEqual([]);
	});

	it("merges a tag edit with their move of a node and their new tag", () => {
		const n1 = node("n1", {}, [0, 0]);
		const { graph, apply } = edited(
			(g) => g.replace({ ...n1, tags: { door: "yes" } }),
			[n1],
		);
		const theirs = { ...n1, tags: { entrance: "main" }, loc: [5, 5] as const };
		const result = rebase(graph, [v2(theirs)]);
		expect(result.conflicts).toEqual([]);
		expect(result.merged).toBe(1);
		expect(apply(result).entity("n1")).toEqual({
			...n1,
			version: 2,
			loc: [5, 5],
			tags: { door: "yes", entrance: "main" },
		});
	});

	it("drops an edit the server already has, and a deletion they made too", () => {
		const { graph, apply } = edited((g) =>
			g
				.replace({
					...way("w1", ["n1", "n2", "n3", "n1"]),
					tags: { indoor: "room", level: "1" },
				})
				.remove("n3"),
		);
		const result = rebase(graph, [
			v2({ ...(ROOM[3] as Entity), tags: { indoor: "room", level: "1" } }),
			v2(null, "n3"),
		]);
		expect(result.gone).toEqual(["n3"]);
		const after = apply(result);
		expect(after.isEdited("w1")).toBe(false);
		expect(after.hasChanges()).toBe(false);
	});

	it("takes their newer versions of unedited nodes the edits use", () => {
		const { graph, apply } = edited((g) =>
			g.replace(way("w-1", ["n1", "n2"], { indoor: "wall" })),
		);
		const moved = node("n1", {}, [9, 9]);
		const after = apply(rebase(graph, [v2(moved)]));
		expect(after.entity("n1")).toEqual({ ...moved, version: 2 });
		expect(after.isEdited("n1")).toBe(false);
	});

	it("reports a tag both changed, a node both moved, and a deletion against an edit", () => {
		const { graph } = edited((g) =>
			g
				.replace({ ...(ROOM[3] as Entity), tags: { indoor: "room", ref: "A" } })
				.replace(node("n1", {}, [3, 3]))
				.replace(node("n2", { door: "yes" }, [1, 0]))
				.remove("n3"),
		);
		const result = rebase(graph, [
			v2({ ...(ROOM[3] as Entity), tags: { indoor: "room", ref: "B" } }),
			v2(node("n1", {}, [4, 4])),
			v2(null, "n2"),
			v2(node("n3", { door: "yes" }, [1, 1])),
		]);
		expect(
			result.conflicts.map(({ id, kind, keys, geometry }) => ({
				id,
				kind,
				keys,
				geometry,
			})),
		).toEqual([
			{ id: "w1", kind: "both-edited", keys: ["ref"], geometry: false },
			{ id: "n1", kind: "both-edited", keys: [], geometry: true },
			{ id: "n2", kind: "deleted-by-them", keys: [], geometry: false },
			{ id: "n3", kind: "deleted-by-me", keys: [], geometry: false },
		]);
		expect(result.conflicts[2]?.theirs.user).toBe("Ana");
		// Nothing of a conflict is taken until it is resolved.
		expect(result.server).toEqual([]);
	});

	it("reports an unedited node deleted on the server that an edited way still uses", () => {
		const { graph } = edited((g) =>
			g.replace({ ...(ROOM[3] as Entity), tags: { indoor: "area" } }),
		);
		const result = rebase(graph, [v2(null, "n2")]);
		expect(result.conflicts.map((c) => [c.id, c.kind])).toEqual([
			["n2", "deleted-in-use"],
		]);
	});
});

describe("resolveConflict", () => {
	const withServer = (graph: Graph, r: ReturnType<typeof resolveConflict>) =>
		r.action(graph.rebaseOnto(graph.base().withBaseEntities(r.server, r.gone)));

	it("keeps mine: the edit goes on over their version", () => {
		const { graph } = edited((g) =>
			g.replace({ ...(ROOM[3] as Entity), tags: { indoor: "room", ref: "A" } }),
		);
		const theirs = {
			...(ROOM[3] as Entity),
			tags: { indoor: "room", ref: "B" },
		};
		const [conflict] = rebase(graph, [v2(theirs)]).conflicts;
		const after = withServer(graph, resolveConflict(graph, conflict!, "mine"));
		expect(after.entity("w1")).toMatchObject({
			version: 2,
			tags: { ref: "A" },
		});
		expect(after.changes().modified.map((e) => e.id)).toEqual(["w1"]);
		// Checked again, it is no conflict any more.
		expect(rebase(after, [v2(theirs)]).conflicts).toEqual([]);
	});

	it("wins only what clashes: the other side's other changes are kept", () => {
		const n1 = node("n1", { door: "yes" }, [0, 0]);
		const { graph } = edited(
			(g) =>
				g.replace({ ...n1, tags: { door: "no", level: "0" }, loc: [1, 1] }),
			[n1],
		);
		const theirs = {
			...n1,
			tags: { door: "hinged", ref: "D1" },
			loc: [2, 2] as const,
		};
		const [conflict] = rebase(graph, [v2(theirs)]).conflicts;
		expect(conflict).toMatchObject({ keys: ["door"], geometry: true });
		const mine = withServer(graph, resolveConflict(graph, conflict!, "mine"));
		expect(mine.entity("n1")).toMatchObject({
			version: 2,
			loc: [1, 1],
			tags: { door: "no", level: "0", ref: "D1" },
		});
		const taken = withServer(
			graph,
			resolveConflict(graph, conflict!, "theirs"),
		);
		expect(taken.entity("n1")).toMatchObject({
			version: 2,
			loc: [2, 2],
			tags: { door: "hinged", level: "0", ref: "D1" },
		});
	});

	it("takes theirs: the edit is dropped", () => {
		const { graph } = edited((g) =>
			g.replace({ ...(ROOM[3] as Entity), tags: { indoor: "room", ref: "A" } }),
		);
		const theirs = {
			...(ROOM[3] as Entity),
			tags: { indoor: "room", ref: "B" },
		};
		const [conflict] = rebase(graph, [v2(theirs)]).conflicts;
		const after = withServer(
			graph,
			resolveConflict(graph, conflict!, "theirs"),
		);
		expect(after.entity("w1")).toEqual({ ...theirs, version: 2 });
		expect(after.hasChanges()).toBe(false);
	});

	it("keeps mine of a feature they deleted: it is sent again, restored", () => {
		const { graph } = edited((g) =>
			g.replace(node("n2", { door: "yes" }, [1, 0])),
		);
		const [conflict] = rebase(graph, [v2(null, "n2")]).conflicts;
		const after = withServer(graph, resolveConflict(graph, conflict!, "mine"));
		expect(after.changes().modified).toEqual(
			[node("n2", { door: "yes" }, [1, 0])].map((n) => ({ ...n, version: 2 })),
		);
	});

	it("restores an unedited node they deleted, kept for an edited way", () => {
		const { graph } = edited((g) =>
			g.replace({ ...(ROOM[3] as Entity), tags: { indoor: "area" } }),
		);
		const [conflict] = rebase(graph, [v2(null, "n2")]).conflicts;
		const after = withServer(graph, resolveConflict(graph, conflict!, "mine"));
		expect(
			after
				.changes()
				.modified.map((e) => [e.id, e.version])
				.sort(),
		).toEqual([
			["n2", 2],
			["w1", 1],
		]);
	});

	it("takes theirs of a deleted node: gone from the ways that used it", () => {
		const wall = way("w2", ["n1", "n2", "n3"], { indoor: "wall" });
		const { graph } = edited(
			(g) => g.replace({ ...wall, tags: { indoor: "wall", level: "0" } }),
			[...ROOM.slice(0, 3), wall],
		);
		const [conflict] = rebase(graph, [v2(null, "n2")]).conflicts;
		const resolved = resolveConflict(graph, conflict!, "theirs");
		expect(resolved.gone).toEqual(["n2"]);
		const after = withServer(graph, resolved);
		expect(after.entity("n2")).toBeUndefined();
		expect(after.entity("w2")).toMatchObject({ nodes: ["n1", "n3"] });
		expect(after.changes().deleted).toEqual([]);
	});

	it("takes theirs of a way the user deleted: it comes back with its nodes", () => {
		const { graph } = edited((g) =>
			g.remove("w1").remove("n1").remove("n2").remove("n3"),
		);
		const theirs = {
			...(ROOM[3] as Entity),
			tags: { indoor: "room", ref: "B" },
		};
		const [conflict] = rebase(graph, [v2(theirs)]).conflicts;
		expect(conflict?.kind).toBe("deleted-by-me");
		const after = withServer(
			graph,
			resolveConflict(graph, conflict!, "theirs"),
		);
		expect(after.entity("w1")).toMatchObject({ version: 2 });
		expect(after.hasChanges()).toBe(false);
	});

	it("keeps mine of a way the user deleted: deleted at their version", () => {
		const { graph } = edited((g) => g.remove("w1"));
		const theirs = {
			...(ROOM[3] as Entity),
			tags: { indoor: "room", ref: "B" },
		};
		const [conflict] = rebase(graph, [v2(theirs)]).conflicts;
		const after = withServer(graph, resolveConflict(graph, conflict!, "mine"));
		expect(after.changes().deleted.map((e) => [e.id, e.version])).toEqual([
			["w1", 2],
		]);
	});
});

describe("missingChildren", () => {
	it("lists the nodes and members not in the graph", () => {
		const graph = Graph.fromEntities(ROOM);
		expect(
			missingChildren(graph, [
				way("w1", ["n1", "n9"]),
				relation("r1", [
					{ ref: "w1", role: "outer" },
					{ ref: "w8", role: "inner" },
				]),
			]),
		).toEqual(["n9", "w8"]);
	});
});
