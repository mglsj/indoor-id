import { describe, expect, it } from "vitest";
import type { Entity, NodeId, WayId } from "#lib/osm/entity.ts";
import { node, relation, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import type { Tags } from "#lib/osm/tags.ts";
import { BLOCKING_RULES, validate } from "./validate.ts";

/** 1e-5 degrees, about 1.1 m at the equator. */
const M = 0.00001;

/** A closed way `id` through nodes `${id}a…` at these positions (in units of `M`). */
function ring(id: WayId, corners: readonly [number, number][], tags: Tags) {
	const ids = corners.map((_, i) => `n${id.slice(1)}${i}` as NodeId);
	return [
		...corners.map(([x, y], i) => node(ids[i] as NodeId, {}, [x * M, y * M])),
		way(id, [...ids, ids[0] as NodeId], tags),
	];
}

/** A square from (x, y), `size` wide. */
function square(id: WayId, x: number, y: number, size: number, tags: Tags) {
	return ring(
		id,
		[
			[x, y],
			[x + size, y],
			[x + size, y + size],
			[x, y + size],
		],
		tags,
	);
}

function rulesOf(entities: Entity[], id: string) {
	return validate(Graph.fromEntities(entities), [id as WayId], []).map(
		(i) => i.rule,
	);
}

function issue(entities: Entity[], id: string, rule: string) {
	const graph = Graph.fromEntities(entities);
	const found = validate(graph, [id as WayId], []).find((i) => i.rule === rule);
	return { graph, issue: found };
}

const ROOM = { indoor: "room", level: "0" };

describe("empty tags", () => {
	it("flags an empty value as an error, fixed by removing it", () => {
		const entities = [node("n1", { amenity: "toilets", name: " " }, [0, 0])];
		const { graph, issue: found } = issue(entities, "n1", "empty-tag");
		expect(found?.severity).toBe("error");
		expect(found?.fix?.action(graph).entity("n1")?.tags).toEqual({
			amenity: "toilets",
		});
	});
});

describe("level outside the building", () => {
	const building = square("w1", 0, 0, 20, {
		building: "yes",
		"building:levels": "2",
	});

	it("flags a room on a level the building doesn't have", () => {
		const entities = [
			...building,
			...square("w2", 5, 5, 5, { indoor: "room", level: "4" }),
		];
		expect(rulesOf(entities, "w2")).toContain("level-outside-building");
	});

	it("accepts the building's levels, 0 and 1", () => {
		const entities = [...building, ...square("w2", 5, 5, 5, ROOM)];
		expect(rulesOf(entities, "w2")).not.toContain("level-outside-building");
	});

	it("ignores a building that says nothing of its levels", () => {
		const entities = [
			...square("w1", 0, 0, 20, { building: "yes" }),
			...square("w2", 5, 5, 5, { indoor: "room", level: "4" }),
		];
		expect(rulesOf(entities, "w2")).not.toContain("level-outside-building");
	});
});

describe("no level outline", () => {
	const building = square("w1", 0, 0, 20, { building: "yes" });
	const level0 = square("w3", 0, 0, 20, { indoor: "level", level: "0" });

	it("flags a room on a level without an indoor=level outline when others have one", () => {
		const entities = [
			...building,
			...level0,
			...square("w2", 5, 5, 5, { indoor: "room", level: "1" }),
		];
		expect(rulesOf(entities, "w2")).toContain("no-level-outline");
	});

	it("accepts a room on a level with its outline, or a building without any", () => {
		expect(
			rulesOf([...building, ...level0, ...square("w2", 5, 5, 5, ROOM)], "w2"),
		).not.toContain("no-level-outline");
		expect(
			rulesOf(
				[...building, ...square("w2", 5, 5, 5, { indoor: "room", level: "1" })],
				"w2",
			),
		).not.toContain("no-level-outline");
	});
});

describe("almost joined", () => {
	// A corridor 10 cm short of the room's side (x = 10).
	const room = square("w1", 0, 0, 10, ROOM);
	const corridor = ring(
		"w2",
		[
			[10.09, 2],
			[20, 2],
			[20, 4],
			[10.09, 4],
		],
		{ indoor: "corridor", level: "0" },
	);

	it("flags each corner a few centimetres from a side, fixed by joining it", () => {
		const entities = [...room, ...corridor];
		const graph = Graph.fromEntities(entities);
		const found = validate(graph, ["w2"], []).filter(
			(i) => i.rule === "almost-joined",
		);
		expect(found.map((i) => i.id)).toEqual([
			"almost-joined:w2:n20",
			"almost-joined:w2:n23",
		]);
		const joined = found[0]?.fix?.action(graph);
		const side = joined?.entity("w1");
		expect(side?.type === "way" && side.nodes).toEqual([
			"n10",
			"n11",
			"n20",
			"n12",
			"n13",
			"n10",
		]);
		const moved = joined?.entity("n20");
		expect(moved?.type === "node" && moved.loc[0]).toBeCloseTo(10 * M, 9);
	});

	it("ignores a side on another level, and a corner already joined", () => {
		const other = square("w1", 0, 0, 10, { indoor: "room", level: "1" });
		expect(rulesOf([...other, ...corridor], "w2")).not.toContain(
			"almost-joined",
		);
		const shared = [
			...room,
			node("n20", {}, [20 * M, 0]),
			node("n21", {}, [20 * M, 10 * M]),
			way("w2", ["n11", "n20", "n21", "n12", "n11"], {
				indoor: "corridor",
				level: "0",
			}),
		];
		expect(rulesOf(shared, "w2")).not.toContain("almost-joined");
	});
});

describe("crossing rooms", () => {
	it("flags two rooms whose outlines cross on one level", () => {
		const entities = [
			...square("w1", 0, 0, 10, ROOM),
			...square("w2", 5, 5, 10, ROOM),
		];
		expect(rulesOf(entities, "w2")).toContain("crossing-rooms");
	});

	it("accepts rooms on different levels, and rooms side by side", () => {
		expect(
			rulesOf(
				[
					...square("w1", 0, 0, 10, ROOM),
					...square("w2", 5, 5, 10, { indoor: "room", level: "1" }),
				],
				"w2",
			),
		).not.toContain("crossing-rooms");
		expect(
			rulesOf(
				[...square("w1", 0, 0, 10, ROOM), ...square("w2", 20, 0, 10, ROOM)],
				"w2",
			),
		).not.toContain("crossing-rooms");
	});
});

describe("unsquare rooms", () => {
	it("flags a room 2° off square, fixed by squaring it", () => {
		// The top right corner pulled 0.35 units right: about 2° off.
		const entities = ring(
			"w1",
			[
				[0, 0],
				[10, 0],
				[10.35, 10],
				[0, 10],
			],
			ROOM,
		);
		const { graph, issue: found } = issue(entities, "w1", "unsquare-room");
		expect(found?.fix).toBeDefined();
		const squared = found?.fix?.action(graph) ?? graph;
		expect(validate(squared, ["w1"], []).map((i) => i.rule)).not.toContain(
			"unsquare-room",
		);
	});

	it("accepts a square room and a shape far from square", () => {
		expect(rulesOf(square("w1", 0, 0, 10, ROOM), "w1")).not.toContain(
			"unsquare-room",
		);
		const slanted = ring(
			"w1",
			[
				[0, 0],
				[10, 0],
				[14, 10],
				[0, 10],
			],
			ROOM,
		);
		expect(rulesOf(slanted, "w1")).not.toContain("unsquare-room");
	});
});

describe("close nodes", () => {
	it("flags two nodes of an indoor way 2 cm apart, fixed by merging them", () => {
		const entities = [
			node("n1", {}, [0, 0]),
			node("n2", {}, [10 * M, 0]),
			node("n3", {}, [10 * M + 0.02 * M, 0]),
			node("n4", {}, [10 * M, 10 * M]),
			way("w1", ["n1", "n2", "n3", "n4", "n1"], ROOM),
		];
		const { graph, issue: found } = issue(entities, "w1", "close-nodes");
		const merged = found?.fix?.action(graph).entity("w1");
		expect(merged?.type === "way" && merged.nodes).toEqual([
			"n1",
			"n2",
			"n4",
			"n1",
		]);
	});

	it("ignores outdoor ways", () => {
		const entities = [
			node("n1", {}, [0, 0]),
			node("n2", {}, [0.02 * M, 0]),
			way("w1", ["n1", "n2"], { highway: "footway" }),
		];
		expect(rulesOf(entities, "w1")).not.toContain("close-nodes");
	});
});

describe("disconnected paths", () => {
	const path = (tags: Tags = {}) => [
		node("n1", {}, [0, 0]),
		node("n2", tags, [5 * M, 0]),
		way("w1", ["n1", "n2"], { highway: "footway", indoor: "yes", level: "0" }),
	];

	it("flags an indoor footway joined to nothing", () => {
		expect(rulesOf(path(), "w1")).toContain("disconnected-path");
	});

	it("accepts a footway ending at a door or joined to another path", () => {
		expect(rulesOf(path({ door: "hinged" }), "w1")).not.toContain(
			"disconnected-path",
		);
		const joined = [
			...path(),
			node("n3", {}, [10 * M, 0]),
			way("w2", ["n2", "n3"], { highway: "corridor" }),
		];
		expect(rulesOf(joined, "w1")).not.toContain("disconnected-path");
	});
});

describe("open multipolygons", () => {
	const lines = [
		node("n1", {}, [0, 0]),
		node("n2", {}, [M, 0]),
		node("n3", {}, [M, M]),
		way("w1", ["n1", "n2", "n3"]),
		way("w2", ["n3", "n1"]),
	];
	const multipolygon = (members: string[]) =>
		relation(
			"r1",
			members.map((ref) => ({ ref: ref as WayId, role: "outer" })),
			{ type: "multipolygon", building: "yes" },
		);

	it("refuses a ring left open, as an error the upload waits on", () => {
		const found = validate(
			Graph.fromEntities([...lines, multipolygon(["w1"])]),
			["r1"],
			[],
		).find((i) => i.rule === "open-multipolygon");
		expect(found?.severity).toBe("error");
		expect(BLOCKING_RULES.has("open-multipolygon")).toBe(true);
	});

	it("accepts open ways that close a ring together, and a relation not all downloaded", () => {
		expect(rulesOf([...lines, multipolygon(["w1", "w2"])], "r1")).toEqual([]);
		expect(rulesOf([...lines, multipolygon(["w1", "w9"])], "r1")).toEqual([]);
	});
});
