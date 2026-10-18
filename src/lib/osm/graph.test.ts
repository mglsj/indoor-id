import { describe, expect, it } from "vitest";
import type { Entity } from "./entity.ts";
import { node, relation, way } from "./fixtures.ts";
import { Graph } from "./graph.ts";

function fixture() {
	return Graph.fromEntities([
		node("n1"),
		node("n2"),
		node("n3"),
		way("w1", ["n1", "n2"]),
		way("w2", ["n2", "n3"]),
		relation("r1", [{ ref: "w1", role: "outer" }]),
	]);
}

describe("Graph", () => {
	it("looks entities up by id", () => {
		const graph = fixture();
		expect(graph.entity("n1")?.type).toBe("node");
		expect(graph.entity("w9")).toBeUndefined();
	});

	it("lists the ways and relations an entity belongs to", () => {
		const graph = fixture();
		expect(
			graph
				.parentWays("n2")
				.map((w) => w.id)
				.sort(),
		).toEqual(["w1", "w2"]);
		expect(graph.parentWays("n1").map((w) => w.id)).toEqual(["w1"]);
		expect(graph.parentRelations("w1").map((r) => r.id)).toEqual(["r1"]);
		expect(graph.parentRelations("w2")).toEqual([]);
	});

	it("returns a new graph on change and leaves the old one untouched", () => {
		const before = fixture();
		const after = before
			.replace({ ...node("n1"), tags: { amenity: "bench" } })
			.remove("w2");

		expect(after.entity("n1")?.tags).toEqual({ amenity: "bench" });
		expect(after.entity("w2")).toBeUndefined();
		expect(before.entity("n1")?.tags).toEqual({});
		expect(before.entity("w2")).toBeDefined();
	});

	it("keeps parent lists up to date after local changes", () => {
		const graph = fixture()
			.replace(way("w2", ["n3"]))
			.replace(way("w-1", ["n1", "n3"]))
			.replace(relation("r1", [{ ref: "w-1", role: "outer" }]));

		expect(graph.parentWays("n2").map((w) => w.id)).toEqual(["w1"]);
		expect(
			graph
				.parentWays("n3")
				.map((w) => w.id)
				.sort(),
		).toEqual(["w-1", "w2"]);
		expect(graph.parentRelations("w1")).toEqual([]);
		expect(graph.parentRelations("w-1").map((r) => r.id)).toEqual(["r1"]);
	});

	it("doesn't list removed parents", () => {
		const graph = fixture().remove("w1");
		expect(graph.parentWays("n1")).toEqual([]);
	});

	it("gives new entities unused negative ids", () => {
		let graph = fixture();
		const first = graph.newId("node");
		expect(first).toBe("n-1");

		graph = graph.replace(node(first));
		const second = graph.newId("way");
		expect(second).toBe("w-2");

		// Ids are not reused after the entity is removed.
		expect(graph.remove(first).newId("node")).toBe("n-3");
	});

	it("never gives the same id twice, even before the entities are added", () => {
		const graph = fixture();
		const [a, b] = [graph.newId("node"), graph.newId("node")];
		expect(a).not.toBe(b);
		const both = graph.replace(node(a)).replace(node(b));
		expect([a, b]).not.toContain(both.newId("node"));
	});
});

describe("Graph.changedSince", () => {
	const base = Graph.fromEntities([node("n1"), node("n2"), node("n3")]);

	it("lists the entities added, changed or removed since another graph", () => {
		const after = base
			.replace(node("n1", { door: "yes" }))
			.remove("n2")
			.replace(node("n-1"));
		expect([...after.changedSince(base)].sort()).toEqual(["n-1", "n1", "n2"]);
		expect([...base.changedSince(after)].sort()).toEqual(["n-1", "n1", "n2"]);
	});

	it("leaves out entities put back as they were (the same object)", () => {
		const edited = base.replace(node("n1", { door: "yes" }));
		const back = edited.replace(base.entity("n1") as Entity);
		expect([...back.changedSince(base)]).toEqual([]);
		expect([...base.changedSince(base)]).toEqual([]);
	});

	it("compares the server data too, when more was downloaded", () => {
		const edited = base.replace(node("n1", { door: "yes" }));
		// Local edits kept on the new server data, as History.merge does.
		const loaded = edited.rebaseOnto(
			edited.withBaseEntities([node("n4"), { ...node("n3"), version: 2 }]),
		);
		expect([...loaded.changedSince(edited)].sort()).toEqual(["n3", "n4"]);
	});
});

describe("Graph over a long history (shared structure, R1.12)", () => {
	const base = () => Graph.fromEntities([node("n1"), node("n2"), node("n3")]);

	it("lists what changed between steps of one history, forwards and back", () => {
		const start = base();
		const one = start.replace(node("n1", { door: "yes" }));
		const two = one.update((g) => g.remove("n2").replace(node("n-1")));
		const three = two.replace(node("n3", { door: "no" }));
		expect([...three.changedSince(one)].sort()).toEqual(["n-1", "n2", "n3"]);
		// Undo: from a later step back to an earlier one.
		expect([...one.changedSince(three)].sort()).toEqual(["n-1", "n2", "n3"]);
		expect([...three.changedSince(start)].sort()).toEqual([
			"n-1",
			"n1",
			"n2",
			"n3",
		]);
		// Steps on other branches (an edit after an undo) are compared whole.
		const other = one.replace(node("n3", { door: "yes" }));
		expect([...other.changedSince(three)].sort()).toEqual(["n-1", "n2", "n3"]);
	});

	it("counts its local changes as changes() lists them, step by step", () => {
		let graph = base();
		const steps: ((g: Graph) => Graph)[] = [
			(g) => g.replace(node("n1", { door: "yes" })),
			(g) => g.replace(node("n-1")),
			(g) => g.remove("n2"),
			// Put back as downloaded (same content): no longer a change.
			(g) => g.replace(node("n1")),
			(g) => g.remove("n-1"),
			(g) => g.update((d) => d.replace(node("n3", { a: "1" })).remove("n1")),
		];
		for (const step of steps) {
			graph = step(graph);
			const { created, modified, deleted } = graph.changes();
			expect(graph.changeCount()).toBe(
				created.length + modified.length + deleted.length,
			);
		}
		expect(graph.changeCount()).toBe(3);
	});
});

describe("Graph.update: many changes on one copy (iD's unfrozen graph)", () => {
	const base = () =>
		Graph.fromEntities([
			node("n1"),
			node("n2"),
			node("n3"),
			way("w1", ["n1", "n2"]),
		]);

	it("applies an action's changes, leaving the graph it started from as it was", () => {
		const graph = base();
		const after = graph.update((g) =>
			g
				.replace(way("w1", ["n1", "n3"]))
				.replace(node("n-1"))
				.remove("n2"),
		);
		expect(after.entity("w1")).toEqual(way("w1", ["n1", "n3"]));
		expect(after.entity("n-1")).toBeDefined();
		expect(after.entity("n2")).toBeUndefined();
		expect(graph.entity("w1")).toEqual(way("w1", ["n1", "n2"]));
		expect(graph.entity("n2")).toBeDefined();
		expect(graph.entity("n-1")).toBeUndefined();
	});

	it("keeps parents up to date while the action runs", () => {
		const seen: string[][] = [];
		base().update((g) => {
			const next = g
				.replace(way("w1", ["n1", "n3"]))
				.replace(relation("r1", [{ ref: "n3", role: "" }]));
			seen.push(next.parentWays("n3").map((w) => w.id));
			seen.push(next.parentWays("n2").map((w) => w.id));
			seen.push(next.parentRelations("n3").map((r) => r.id));
			return next;
		});
		expect(seen).toEqual([["w1"], [], ["r1"]]);
	});

	it("gives a graph that is immutable again", () => {
		const after = base().update((g) => g.replace(node("n1", { door: "yes" })));
		const again = after.replace(node("n1", { door: "no" }));
		expect(after.entity("n1")?.tags).toEqual({ door: "yes" });
		expect(again.entity("n1")?.tags).toEqual({ door: "no" });
		expect(again.changedSince(after)).toEqual(new Set(["n1"]));
	});

	it("gives new ids that no entity of the copy uses", () => {
		const graph = base();
		const after = graph.update((g) => {
			const a = g.newId("node");
			const withA = g.replace(node(a));
			return withA.replace(node(withA.newId("node")));
		});
		expect([...after.changedSince(graph)].sort()).toEqual(["n-1", "n-2"]);
	});
});
