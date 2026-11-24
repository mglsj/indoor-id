import { describe, expect, it } from "vitest";
import { msg } from "#lib/i18n/messages.ts";
import type { Entity, EntityId, NodeId, WayId } from "#lib/osm/entity.ts";
import { node, relation, way } from "#lib/osm/fixtures.ts";
import { fromLocal } from "#lib/osm/geometry.ts";
import { Graph } from "#lib/osm/graph.ts";
import type { Tags } from "#lib/osm/tags.ts";
import { jitterCorners } from "./recheck.ts";
import { type IssueRule, validate } from "./validate.ts";

const W3: readonly IssueRule[] = ["wall-twice", "jitter", "door-on-side"];

/** A position `east` and `north` metres from (0, 0). */
const at = (east: number, north: number) =>
	fromLocal([0, 0], [east, north]) as [number, number];

/** A closed way `id` through nodes n{first}… at these positions in metres. */
function ring(
	id: WayId,
	first: number,
	corners: readonly [number, number][],
	tags: Tags,
): Entity[] {
	const ids = corners.map((_, i) => `n${first + i}` as NodeId);
	return [
		...corners.map(([x, y], i) => node(ids[i] as NodeId, {}, at(x, y))),
		way(id, [...ids, ids[0] as NodeId], tags),
	];
}

function issuesOf(entities: Entity[], id: EntityId) {
	const graph = Graph.fromEntities(entities);
	return {
		graph,
		issues: validate(graph, [id], []).filter((i) => W3.includes(i.rule)),
	};
}

const rulesOf = (entities: Entity[], id: EntityId) =>
	issuesOf(entities, id).issues.map((i) => i.rule);

describe("wall drawn twice", () => {
	/** A 4 × 0.2 m wall area, n1…n4. */
	const area = ring(
		"w1",
		1,
		[
			[0, 0],
			[4, 0],
			[4, 0.2],
			[0, 0.2],
		],
		{ indoor: "wall", area: "yes", level: "0" },
	);

	it("flags a wall line along a wall area's side; the fix deletes a line with nothing else", () => {
		const entities = [
			...area,
			way("w2", ["n1", "n2"], { indoor: "wall", level: "0" }),
		];
		const { graph, issues } = issuesOf(entities, "w2");
		expect(issues.map((i) => i.rule)).toEqual(["wall-twice"]);
		expect(issues[0]?.message).toEqual(msg("issue_wall_twice"));
		const fixed = issues[0]?.fix?.action(graph);
		expect(fixed?.entity("w2")).toBeUndefined();
		// The area keeps its nodes.
		expect(fixed?.entity("n1")).toBeDefined();
	});

	it("keeps a line that has other tags, without its wall keys", () => {
		const entities = [
			...area,
			way("w2", ["n1", "n2"], {
				indoor: "wall",
				level: "0",
				material: "glass",
				name: "Shop front",
			}),
		];
		const { graph, issues } = issuesOf(entities, "w2");
		expect(issues[0]?.fix?.action(graph).entity("w2")?.tags).toEqual({
			name: "Shop front",
		});
	});

	it("finds a wall multipolygon too", () => {
		const outer = ring(
			"w1",
			1,
			[
				[0, 0],
				[4, 0],
				[4, 0.2],
				[0, 0.2],
			],
			{},
		);
		const entities = [
			...outer,
			relation("r1", [{ ref: "w1", role: "outer" }], {
				type: "multipolygon",
				indoor: "wall",
				level: "0",
			}),
			way("w2", ["n2", "n3"], { indoor: "wall", level: "0" }),
		];
		expect(rulesOf(entities, "w2")).toEqual(["wall-twice"]);
	});

	it("leaves a line that leaves the area, or is on another level", () => {
		const away = [
			...area,
			node("n9", {}, at(4, 3)),
			way("w2", ["n2", "n9"], { indoor: "wall", level: "0" }),
		];
		expect(rulesOf(away, "w2")).toEqual([]);
		const upstairs = [
			...area,
			way("w2", ["n1", "n2"], { indoor: "wall", level: "1" }),
		];
		expect(rulesOf(upstairs, "w2")).toEqual([]);
	});
});

describe("jitter vertices", () => {
	it("finds corners a few centimetres off a straight side next to a tiny side", () => {
		// A 4 m side with a 2 cm kink at 2 m: (2, -0.02) and (2.05, 0).
		const points: [number, number][] = [
			[0, 0],
			[2, -0.02],
			[2.05, 0],
			[4, 0],
			[4, 3],
			[0, 3],
		];
		const all = points.map(() => true);
		expect(jitterCorners(points, all)).toEqual([1, 2]);
		// A corner another way needs stays.
		expect(
			jitterCorners(points, [true, false, true, true, true, true]),
		).toEqual([2]);
	});

	it("leaves a real step and a point on a long straight side", () => {
		// A 30 cm step is a shape.
		const step: [number, number][] = [
			[0, 0],
			[2, 0],
			[2, 0.3],
			[4, 0.3],
			[4, 3],
			[0, 3],
		];
		expect(
			jitterCorners(
				step,
				step.map(() => true),
			),
		).toEqual([]);
		// (2, 0) on a straight 4 m side: a junction with a neighbour, no short side next to it.
		const straight: [number, number][] = [
			[0, 0],
			[2, 0],
			[4, 0],
			[4, 3],
			[0, 3],
		];
		expect(
			jitterCorners(
				straight,
				straight.map(() => true),
			),
		).toEqual([]);
	});

	it("flags a room with jitter; the fix removes those corners", () => {
		const room = ring(
			"w1",
			1,
			[
				[0, 0],
				[2, -0.02],
				[2.05, 0],
				[4, 0],
				[4, 3],
				[0, 3],
			],
			{ indoor: "room", level: "0" },
		);
		const { graph, issues } = issuesOf(room, "w1");
		expect(issues.map((i) => i.rule)).toEqual(["jitter"]);
		expect(issues[0]?.message).toEqual(
			msg("issue_jitter", { count: 2, tolerance: 3 }),
		);
		const fixed = issues[0]?.fix?.action(graph);
		const w1 = fixed?.entity("w1");
		expect(w1?.type === "way" && w1.nodes).toEqual([
			"n1",
			"n4",
			"n5",
			"n6",
			"n1",
		]);
		expect(fixed?.entity("n2")).toBeUndefined();
	});

	it("doesn't flag corners that are tagged or shared", () => {
		const room = ring(
			"w1",
			1,
			[
				[0, 0],
				[2, -0.02],
				[2.05, 0],
				[4, 0],
				[4, 3],
				[0, 3],
			],
			{ indoor: "room", level: "0" },
		);
		const shared = [
			...room.map((e) =>
				e.id === "n2" || e.id === "n3" ? { ...e, tags: { door: "yes" } } : e,
			),
		];
		expect(rulesOf(shared, "w1")).toEqual([]);
	});
});

describe("door on a side without being its node", () => {
	const room = ring(
		"w1",
		1,
		[
			[0, 0],
			[4, 0],
			[4, 3],
			[0, 3],
		],
		{ indoor: "room", level: "0" },
	);

	it("flags a door lying on a room's side; the fix puts it in the side", () => {
		const entities = [
			...room,
			node("n9", { door: "hinged", level: "0" }, at(2, 0.05)),
		];
		const { graph, issues } = issuesOf(entities, "n9");
		expect(issues.map((i) => i.rule)).toEqual(["door-on-side"]);
		const fixed = issues[0]?.fix?.action(graph);
		const w1 = fixed?.entity("w1");
		expect(w1?.type === "way" && w1.nodes).toEqual([
			"n1",
			"n9",
			"n2",
			"n3",
			"n4",
			"n1",
		]);
	});

	it("leaves a door in the side, far from it, or on another level", () => {
		const inSide = [
			node("n1", {}, at(0, 0)),
			node("n9", { door: "hinged" }, at(2, 0)),
			node("n2", {}, at(4, 0)),
			node("n3", {}, at(4, 3)),
			node("n4", {}, at(0, 3)),
			way("w1", ["n1", "n9", "n2", "n3", "n4", "n1"], {
				indoor: "room",
				level: "0",
			}),
		];
		expect(rulesOf(inSide, "n9")).toEqual([]);
		const far = [...room, node("n9", { door: "hinged" }, at(2, 1))];
		expect(rulesOf(far, "n9")).toEqual([]);
		const upstairs = [
			...room,
			node("n9", { door: "hinged", level: "1" }, at(2, 0.05)),
		];
		expect(rulesOf(upstairs, "n9")).toEqual([]);
	});

	it("checks entrances against a building's outline, not indoor doors on a room", () => {
		const building = ring(
			"w1",
			1,
			[
				[0, 0],
				[10, 0],
				[10, 8],
				[0, 8],
			],
			{ building: "yes" },
		);
		const entrance = [
			...building,
			node("n9", { entrance: "main" }, at(5, 0.1)),
		];
		expect(rulesOf(entrance, "n9")).toEqual(["door-on-side"]);
		// A door on a room drawn 10 cm inside the outer wall: not meant to be in the outline.
		const nearWall = [
			...building,
			node("n11", {}, at(1, 0.1)),
			node("n12", {}, at(4, 0.1)),
			node("n13", {}, at(4, 3)),
			node("n14", {}, at(1, 3)),
			node("n15", { door: "hinged" }, at(2, 0.1)),
			way("w2", ["n11", "n15", "n12", "n13", "n14", "n11"], {
				indoor: "room",
				level: "0",
			}),
		];
		expect(rulesOf(nearWall, "n15")).toEqual([]);
	});
});

describe("not copied from osm-simple3d-editor", () => {
	it("asks an outdoor entrance for no indoor tags (forum t/148767 #204)", () => {
		const entities = [
			...ring(
				"w1",
				1,
				[
					[0, 0],
					[10, 0],
					[10, 8],
					[0, 8],
				],
				{ building: "yes" },
			).filter((e) => e.type === "node"),
			node("n9", { entrance: "main" }, at(5, 0)),
			way("w1", ["n1", "n9", "n2", "n3", "n4", "n1"], { building: "yes" }),
		];
		const graph = Graph.fromEntities(entities);
		expect(validate(graph, ["n9"], [])).toEqual([]);
	});
});
