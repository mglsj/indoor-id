import { describe, expect, it } from "vitest";
import type { Entity, Way, WayId } from "#lib/osm/entity.ts";
import { node, relation, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { splitAreas, splitTargets } from "./split-areas.ts";

/** 1e-5° is about 1.1 m on the equator. */
const M = 1e-5;

/**
 * Two rooms side by side on the equator, 4 × 4 (in 1e-5°): w1 from x 0 to 4, w2 from 4 to 8,
 * sharing the side n2–n3; a building w9 whose outline runs along w1's south side n1–n2.
 */
const rooms = (extra: Entity[] = []) =>
	Graph.fromEntities([
		node("n1", {}, [0, 0]),
		node("n2", {}, [4 * M, 0]),
		node("n3", {}, [4 * M, 4 * M]),
		node("n4", {}, [0, 4 * M]),
		node("n5", {}, [8 * M, 0]),
		node("n6", {}, [8 * M, 4 * M]),
		way("w1", ["n1", "n2", "n3", "n4", "n1"], { indoor: "room", level: "0" }),
		way("w2", ["n2", "n5", "n6", "n3", "n2"], { indoor: "room", level: "0" }),
		node("n7", {}, [0, -4 * M]),
		way("w9", ["n1", "n2", "n7", "n1"], { building: "yes" }),
		...extra,
	]);

const ways = (g: Graph, tag = "room") =>
	[...g.entities()].filter(
		(e): e is Way => e.type === "way" && e.tags.indoor === tag,
	);

describe("splitAreas", () => {
	it("cuts a room in two along a straight cut, the pieces sharing the cut's nodes", () => {
		const g = rooms();
		const cut = [
			[2 * M, -1 * M],
			[2 * M, 5 * M],
		] as const;
		expect(splitTargets(g, cut, ["w1", "w2"])).toEqual(["w1"]);
		const after = splitAreas(cut, ["w1", "w2"])(g);
		const pieces = ways(after).filter((w) => w.id !== "w2");
		expect(pieces).toHaveLength(2);
		expect(pieces.map((w) => w.id)).toContain("w1");
		for (const piece of pieces) {
			expect(piece.tags).toEqual({ indoor: "room", level: "0" });
			// Two corners of the room and the two cut nodes, closed.
			expect(piece.nodes).toHaveLength(5);
		}
		const [a, b] = pieces as [Way, Way];
		const shared = a.nodes.filter((n) => b.nodes.includes(n));
		expect(new Set(shared).size).toBe(2);
		const locs = [...new Set(shared)].map(
			(id) => (after.entity(id) as { loc: readonly number[] }).loc,
		);
		for (const [x = 0] of locs) expect(x / M).toBeCloseTo(2, 9);
	});

	it("puts a crossing on a side shared with another room into that room once", () => {
		const g = rooms();
		const cut = [
			[-1 * M, 2 * M],
			[9 * M, 2 * M],
		] as const;
		const after = splitAreas(cut, ["w1", "w2"])(g);
		const all = ways(after);
		expect(all).toHaveLength(4);
		// One node where the cut crosses the shared side n2–n3, in all four pieces.
		const onShared = [...after.entities()].filter(
			(e) =>
				e.type === "node" &&
				Math.abs(e.loc[0] - 4 * M) < 1e-12 &&
				Math.abs(e.loc[1] - 2 * M) < 1e-12,
		);
		expect(onShared).toHaveLength(1);
		const id = onShared[0]?.id;
		expect(all.filter((w) => w.nodes.includes(id as never))).toHaveLength(4);
	});

	it("leaves building outlines along the cut side alone", () => {
		const g = rooms();
		// Cuts w1 from its south side (shared with the building) to its north side.
		const after = splitAreas(
			[
				[2 * M, -1 * M],
				[2 * M, 5 * M],
			],
			["w1"],
		)(g);
		expect(after.entity("w9")).toEqual(g.entity("w9"));
	});

	it("keeps the cut's corners inside the room in both pieces", () => {
		const g = rooms();
		const after = splitAreas(
			[
				[-1 * M, 1 * M],
				[2 * M, 1 * M],
				[2 * M, 5 * M],
			],
			["w1"],
		)(g);
		const pieces = ways(after).filter((w) => w.id !== "w2");
		expect(pieces).toHaveLength(2);
		const [a, b] = pieces as [Way, Way];
		const shared = new Set(a.nodes.filter((n) => b.nodes.includes(n)));
		// Two crossings and the bend at (2, 1).
		expect(shared.size).toBe(3);
	});

	it("doesn't split where the cut runs inside for less than 0.5 m", () => {
		const g = rooms();
		const cut = [
			[-0.2 * M, 0.2 * M],
			[0.2 * M, -0.2 * M],
		] as const;
		expect(splitTargets(g, cut, ["w1"])).toEqual([]);
		expect(splitAreas(cut, ["w1"])(g)).toBe(g);
	});

	it("crosses at a corner through the corner", () => {
		const g = rooms();
		// From the corner n1 to the corner n3, diagonally.
		const after = splitAreas(
			[
				[-1 * M, -1 * M],
				[5 * M, 5 * M],
			],
			["w1"],
		)(g);
		const pieces = ways(after).filter((w) => w.id !== "w2");
		expect(pieces).toHaveLength(2);
		for (const piece of pieces) expect(piece.nodes).toHaveLength(4);
		expect(after.entities().next()).toBeDefined();
		const nodes = [...after.entities()].filter((e) => e.type === "node");
		expect(nodes).toHaveLength(7);
	});

	it("adds the new pieces to the room's relations, with its role", () => {
		const g = rooms([
			relation("r1", [{ ref: "w1", role: "part" }], { type: "site" }),
		]);
		const after = splitAreas(
			[
				[2 * M, -1 * M],
				[2 * M, 5 * M],
			],
			["w1"],
		)(g);
		const site = after.entity("r1");
		const members = site?.type === "relation" ? site.members : [];
		expect(members).toHaveLength(2);
		expect(members.every((m) => m.role === "part")).toBe(true);
		expect(members[0]?.ref).toBe("w1");
	});

	it("doesn't cut what isn't a room, corridor or area", () => {
		const g = rooms();
		expect(
			splitTargets(
				g,
				[
					[1 * M, -5 * M],
					[1 * M, 5 * M],
				],
				["w9" as WayId],
			),
		).toEqual([]);
	});
});
