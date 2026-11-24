import { describe, expect, it } from "vitest";
import type { Entity, Relation } from "#lib/osm/entity.ts";
import { node, relation, way } from "#lib/osm/fixtures.ts";
import { fromLocal } from "#lib/osm/geometry.ts";
import { Graph } from "#lib/osm/graph.ts";
import { cutOutOfLevel, levelOutlineAround } from "./cut-out.ts";

const at = (e: number, n: number) => fromLocal([13.4, 52.5], [e, n]);

/** A closed way through new nodes n{first}… at the corners given. */
function ring(
	id: `w${number}`,
	first: number,
	corners: [number, number][],
	tags = {},
) {
	const nodes = corners.map(([e, n], i) => node(`n${first + i}`, {}, at(e, n)));
	const ids = nodes.map((n) => n.id);
	return [...nodes, way(id, [...ids, ids[0] as `n${number}`], tags)];
}

const square = (x0: number, y0: number, size: number): [number, number][] => [
	[x0, y0],
	[x0 + size, y0],
	[x0 + size, y0 + size],
	[x0, y0 + size],
];

/** The level 1 outline w1 (0–40 m), an atrium w2 drawn inside it on level 1. */
const floor = (extra: Entity[] = []) =>
	Graph.fromEntities([
		...ring("w1", 10, square(0, 0, 40), {
			indoor: "level",
			level: "1",
			name: "First floor",
		}),
		...ring("w2", 20, square(10, 10, 10), { area: "yes", level: "1" }),
		// Level 0's outline, under it.
		...ring("w3", 30, square(0, 0, 40), { indoor: "level", level: "0" }),
		...extra,
	]);

describe("levelOutlineAround (P6)", () => {
	it("finds the level outline on the same level around the way", () => {
		expect(levelOutlineAround(floor(), "w2", 1)).toBe("w1");
		expect(levelOutlineAround(floor(), "w2", 0)).toBe("w3");
	});

	it("finds none outside any outline, or for the outline itself", () => {
		const g = floor(ring("w4", 40, square(50, 0, 5), { level: "1" }));
		expect(levelOutlineAround(g, "w4", 1)).toBeNull();
		expect(levelOutlineAround(g, "w1", 1)).toBeNull();
	});
});

describe("cutOutOfLevel (P6, osm-simple3d-editor 6e898c1)", () => {
	it("makes the outline a multipolygon with the way as its hole", () => {
		const after = cutOutOfLevel("w2", 1)(floor());
		const made = [...after.entities()].find(
			(e): e is Relation => e.type === "relation",
		);
		expect(made?.tags).toEqual({
			type: "multipolygon",
			indoor: "level",
			level: "1",
			name: "First floor",
		});
		expect(made?.members).toEqual([
			{ ref: "w1", role: "outer" },
			{ ref: "w2", role: "inner" },
		]);
		// The hole keeps no drawing tags; the outline gave its own to the relation.
		expect(after.entity("w2")?.tags).toEqual({});
		expect(after.entity("w1")?.tags).toEqual({});
	});

	it("adds a hole to an outline that is a multipolygon already", () => {
		const g = Graph.fromEntities([
			...ring("w1", 10, square(0, 0, 40)),
			...ring("w5", 50, square(30, 30, 5)),
			relation(
				"r1",
				[
					{ ref: "w1", role: "outer" },
					{ ref: "w5", role: "inner" },
				],
				{ type: "multipolygon", indoor: "level", level: "1" },
			),
			...ring("w2", 20, square(10, 10, 10), { area: "yes", level: "1" }),
		]);
		expect(levelOutlineAround(g, "w2", 1)).toBe("r1");
		const after = cutOutOfLevel("w2", 1)(g);
		expect((after.entity("r1") as Relation).members.at(-1)).toEqual({
			ref: "w2",
			role: "inner",
		});
	});
});
