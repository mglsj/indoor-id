import { describe, expect, it } from "vitest";
import { msg } from "#lib/i18n/messages.ts";
import type { Entity, EntityId, NodeId, WayId } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { fromLocal } from "#lib/osm/geometry.ts";
import { Graph } from "#lib/osm/graph.ts";
import type { Tags } from "#lib/osm/tags.ts";
import { type IssueRule, validate } from "./validate.ts";

const B: readonly IssueRule[] = [
	"building-overlap",
	"building-inside",
	"unglued-wall",
];

const at = (east: number, north: number) =>
	fromLocal([0, 0], [east, north]) as [number, number];

/** A rectangle way `id`, nodes n{first}…n{first+3}, from (x0, y0) to (x1, y1) metres. */
function rect(
	id: WayId,
	first: number,
	[x0, y0]: [number, number],
	[x1, y1]: [number, number],
	tags: Tags = { building: "yes" },
): Entity[] {
	const ids = [0, 1, 2, 3].map((i) => `n${first + i}` as NodeId);
	const corners = [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)];
	return [
		...corners.map((loc, i) => node(ids[i] as NodeId, {}, loc)),
		way(id, [...ids, ids[0] as NodeId], tags),
	];
}

function issuesOf(entities: Entity[], id: EntityId) {
	const graph = Graph.fromEntities(entities);
	return {
		graph,
		issues: validate(graph, [id], []).filter((i) => B.includes(i.rule)),
	};
}

const rulesOf = (entities: Entity[], id: EntityId) =>
	issuesOf(entities, id).issues.map((i) => i.rule);

describe("buildings that overlap", () => {
	it("flags two buildings overlapping by 2 m² or more, on both", () => {
		// 10 × 10 and a neighbour 1 m into it: 10 m².
		const entities = [
			...rect("w1", 1, [0, 0], [10, 10]),
			...rect("w2", 11, [9, 0], [19, 10]),
		];
		const { issues } = issuesOf(entities, "w1");
		expect(issues.map((i) => i.rule)).toEqual(["building-overlap"]);
		expect(issues[0]?.message).toEqual(
			msg("issue_building_overlap", { area: 10 }),
		);
		expect(rulesOf(entities, "w2")).toEqual(["building-overlap"]);
	});

	it("doesn't count a shared wall drawn loosely (thin) or a small overlap", () => {
		// 10 cm into the neighbour along the whole wall: 1 m², 0.1 m thick. Its walls aren't
		// glued, though.
		const thin = [
			...rect("w1", 1, [0, 0], [10, 10]),
			...rect("w2", 11, [9.9, 0], [19.9, 10]),
		];
		expect(rulesOf(thin, "w1")).toEqual(["unglued-wall"]);
		// A 1 × 1 m corner: thick enough, too small.
		const corner = [
			...rect("w1", 1, [0, 0], [10, 10]),
			...rect("w2", 11, [9, 9], [19, 19]),
		];
		expect(rulesOf(corner, "w1")).toEqual([]);
	});

	it("leaves roofs, raised buildings and other layers", () => {
		for (const tags of <Tags[]>[
			{ building: "roof" },
			{ building: "yes", min_height: "4" },
			{ building: "yes", layer: "1" },
		]) {
			const entities = [
				...rect("w1", 1, [0, 0], [10, 10]),
				...rect("w2", 11, [5, 0], [15, 10], tags),
			];
			expect(rulesOf(entities, "w1")).toEqual([]);
		}
	});
});

describe("a building inside a building", () => {
	const entities = [
		...rect("w1", 1, [0, 0], [20, 20], { building: "retail" }),
		...rect("w2", 11, [5, 5], [10, 10], { building: "retail" }),
	];

	it("suggests a building part on the inner one, nothing on the outer one", () => {
		const { graph, issues } = issuesOf(entities, "w2");
		expect(issues.map((i) => i.rule)).toEqual(["building-inside"]);
		expect(issues[0]?.fix?.action(graph).entity("w2")?.tags).toEqual({
			"building:part": "retail",
		});
		expect(rulesOf(entities, "w1")).toEqual([]);
	});
});

describe("unglued shared walls", () => {
	it("flags corners within 15 cm of another building's wall; the fix joins them", () => {
		// The neighbour's corners stand 10 cm off w1's east wall.
		const entities = [
			...rect("w1", 1, [0, 0], [10, 10]),
			...rect("w2", 11, [10.1, 2], [20, 8]),
		];
		const { graph, issues } = issuesOf(entities, "w2");
		expect(issues.map((i) => i.rule)).toEqual(["unglued-wall"]);
		const fixed = issues[0]?.fix?.action(graph);
		const w1 = fixed?.entity("w1");
		// Both corners (n11 at y=2, n14 at y=8) now in the wall n2–n3.
		expect(w1?.type === "way" && w1.nodes).toEqual([
			"n1",
			"n2",
			"n11",
			"n14",
			"n3",
			"n4",
			"n1",
		]);
	});

	it("leaves glued walls and gaps wider than 15 cm", () => {
		const glued = [
			...rect("w1", 1, [0, 0], [10, 10]),
			node("n12", {}, at(20, 0)),
			node("n13", {}, at(20, 10)),
			way("w2", ["n2", "n12", "n13", "n3", "n2"], { building: "yes" }),
		];
		expect(rulesOf(glued, "w2")).toEqual([]);
		const apart = [
			...rect("w1", 1, [0, 0], [10, 10]),
			...rect("w2", 11, [10.3, 2], [20, 8]),
		];
		expect(rulesOf(apart, "w2")).toEqual([]);
	});
});
