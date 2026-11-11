import { describe, expect, it } from "vitest";
import { buildFeatures } from "#lib/map/features.ts";
import type { Entity, Loc, NodeId, Way } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph, getEntity } from "#lib/osm/graph.ts";
import { mapFloor, unmappedFloorAt } from "./unmapped-floor.ts";

/** 1e-5° is about 1.1 m on the equator. */
const M = 1e-5;
const at = (x: number, y: number): Loc => [x * M, y * M];

/**
 * A level 0 outline w1, 10 × 10 (in 1e-5°), corners n1 (0, 0) to n4 (0, 10); a room w2 in its
 * south-west corner, 4 × 4, sharing n1 and with corners n5 and n7 on the outline's sides
 * (not in the outline: the usual T-junctions).
 */
const level = (extra: Entity[] = []) =>
	Graph.fromEntities([
		node("n1", {}, at(0, 0)),
		node("n2", {}, at(10, 0)),
		node("n3", {}, at(10, 10)),
		node("n4", {}, at(0, 10)),
		way("w1", ["n1", "n2", "n3", "n4", "n1"], { indoor: "level", level: "0" }),
		node("n5", {}, at(4, 0)),
		node("n6", {}, at(4, 4)),
		node("n7", {}, at(0, 4)),
		way("w2", ["n1", "n5", "n6", "n7", "n1"], { indoor: "room", level: "0" }),
		...extra,
	]);

const features = (g: Graph) => buildFeatures(g).collection.features;

/** A ring's corners as a set, wherever it starts. */
const corners = (g: Graph, id: string) =>
	new Set(getEntity(g, id as Way["id"], "way").nodes);

describe("unmappedFloorAt", () => {
	it("finds the level outline minus the room under a click on empty floor", () => {
		const floor = unmappedFloorAt(features(level()), at(7, 7), 0);
		expect(floor).toMatchObject({ level: 0, container: "w1", cutOut: ["w2"] });
		// 100 - 16 units of 1.11 m × 1.11 m.
		expect(floor?.area).toBeCloseTo(84 * 1.11195 ** 2, 0);
		expect(floor?.rings).toHaveLength(1);
		expect(
			new Set(floor?.rings[0]?.map(([x, y]) => `${x / M},${y / M}`)),
		).toEqual(new Set(["4,0", "10,0", "10,10", "0,10", "0,4", "4,4"]));
	});

	it("finds nothing inside a room, outside any outline, or on another level", () => {
		const g = level();
		expect(unmappedFloorAt(features(g), at(2, 2), 0)).toBeNull();
		expect(unmappedFloorAt(features(g), at(20, 20), 0)).toBeNull();
		expect(unmappedFloorAt(features(g), at(7, 7), 1)).toBeNull();
	});

	it("leaves rooms on other levels in the floor", () => {
		const g = level([
			node("n8", {}, at(6, 6)),
			node("n9", {}, at(8, 6)),
			node("n10", {}, at(8, 8)),
			node("n11", {}, at(6, 8)),
			way("w3", ["n8", "n9", "n10", "n11", "n8"], {
				indoor: "room",
				level: "1",
			}),
		]);
		const floor = unmappedFloorAt(features(g), at(7, 7), 0);
		expect(floor?.cutOut).toEqual(["w2"]);
	});

	it("takes the building when the level has no outline", () => {
		const g = Graph.fromEntities([
			node("n1", {}, at(0, 0)),
			node("n2", {}, at(10, 0)),
			node("n3", {}, at(10, 10)),
			node("n4", {}, at(0, 10)),
			way("w1", ["n1", "n2", "n3", "n4", "n1"], {
				building: "yes",
				"building:levels": "2",
			}),
			node("n5", {}, at(4, 0)),
			node("n6", {}, at(4, 4)),
			node("n7", {}, at(0, 4)),
			way("w2", ["n1", "n5", "n6", "n7", "n1"], {
				indoor: "room",
				level: "1",
			}),
		]);
		const floor = unmappedFloorAt(features(g), at(7, 7), 1);
		expect(floor).toMatchObject({ container: "w1", cutOut: ["w2"] });
	});

	it("ignores gaps between rooms smaller than half a square metre", () => {
		// Two rooms 1 cm apart fill the level.
		const g = Graph.fromEntities([
			node("n1", {}, at(0, 0)),
			node("n2", {}, at(10, 0)),
			node("n3", {}, at(10, 10)),
			node("n4", {}, at(0, 10)),
			way("w1", ["n1", "n2", "n3", "n4", "n1"], {
				indoor: "level",
				level: "0",
			}),
			node("n5", {}, at(5, 0)),
			node("n6", {}, at(5, 10)),
			node("n7", {}, at(5.001, 0)),
			node("n8", {}, at(5.001, 10)),
			way("w2", ["n1", "n5", "n6", "n4", "n1"], { indoor: "room", level: "0" }),
			way("w3", ["n7", "n2", "n3", "n8", "n7"], { indoor: "room", level: "0" }),
		]);
		expect(unmappedFloorAt(features(g), at(5.0005, 5), 0)).toBeNull();
	});
});

describe("mapFloor", () => {
	it("draws the floor as an indoor=area through its neighbours' nodes", () => {
		const g = level();
		const floor = unmappedFloorAt(features(g), at(7, 7), 0);
		if (!floor) throw new Error("no floor");
		const { graph, select } = mapFloor(g, floor, {});
		const [id] = select;
		const area = getEntity(graph, id as Way["id"], "way");
		expect(area.tags).toEqual({ indoor: "area", level: "0" });
		expect(area.nodes[0]).toBe(area.nodes.at(-1));
		expect(corners(graph, area.id)).toEqual(
			new Set(["n5", "n2", "n3", "n4", "n7", "n6"]),
		);
		// No node was made, and the neighbours are as they were.
		expect(graph.changes().created).toHaveLength(1);
		expect(graph.changes().modified).toHaveLength(0);
	});

	it("keeps a preset's indoor value and drops area=yes", () => {
		const g = level();
		const floor = unmappedFloorAt(features(g), at(7, 7), 0);
		if (!floor) throw new Error("no floor");
		const room = mapFloor(g, floor, { indoor: "room", room: "office" });
		expect(room.graph.entity(room.select[0] as Way["id"])?.tags).toEqual({
			indoor: "room",
			room: "office",
			level: "0",
		});
		const plain = mapFloor(g, floor, { area: "yes", shop: "kiosk" });
		expect(plain.graph.entity(plain.select[0] as Way["id"])?.tags).toEqual({
			shop: "kiosk",
			indoor: "area",
			level: "0",
		});
	});

	it("passes through the corners neighbours share along a straight side", () => {
		// A second room east of w2 along the south side: their shared corner n6 is on the
		// floor's straight side from n7 to n9.
		const g = level([
			node("n8", {}, at(8, 0)),
			node("n9", {}, at(8, 4)),
			way("w3", ["n5", "n8", "n9", "n6", "n5"], { indoor: "room", level: "0" }),
		]);
		const floor = unmappedFloorAt(features(g), at(7, 7), 0);
		if (!floor) throw new Error("no floor");
		const { graph, select } = mapFloor(g, floor, {});
		const area = getEntity(graph, select[0] as Way["id"], "way");
		expect(corners(graph, area.id)).toEqual(
			new Set(["n8", "n2", "n3", "n4", "n7", "n6", "n9"]),
		);
		// In order: n7, n6, n9 along y = 4.
		const open = area.nodes.slice(0, -1);
		const i = open.indexOf("n6");
		const neighbours = [open.at(i - 1), open[(i + 1) % open.length]];
		expect(new Set(neighbours)).toEqual(new Set(["n7", "n9"]));
	});

	it("puts a node where a room's side crosses the outline into both", () => {
		// A room w3 sticking out east of the outline, through its side n2–n3.
		const g = level([
			node("n8", {}, at(8, 6)),
			node("n9", {}, at(12, 6)),
			node("n10", {}, at(12, 8)),
			node("n11", {}, at(8, 8)),
			way("w3", ["n8", "n9", "n10", "n11", "n8"], {
				indoor: "room",
				level: "0",
			}),
		]);
		const floor = unmappedFloorAt(features(g), at(5, 5), 0);
		if (!floor) throw new Error("no floor");
		const { graph, select } = mapFloor(g, floor, {});
		const created = graph.changes().created.filter((e) => e.type === "node");
		expect(created).toHaveLength(2);
		const ids = created.map((n) => n.id as NodeId);
		const area = getEntity(graph, select[0] as Way["id"], "way");
		for (const id of ids) {
			expect(area.nodes).toContain(id);
			expect(getEntity(graph, "w1", "way").nodes).toContain(id);
			expect(getEntity(graph, "w3", "way").nodes).toContain(id);
		}
		// On the outline between n2 and n3, the lower one first.
		const outline = getEntity(graph, "w1", "way").nodes;
		expect(outline.slice(1, 5)).toEqual(["n2", ...ids.sort(byY(graph)), "n3"]);
	});

	it("makes a multipolygon around a room standing alone, with the room as its hole", () => {
		const g = level([
			node("n8", {}, at(6, 6)),
			node("n9", {}, at(8, 6)),
			node("n10", {}, at(8, 8)),
			node("n11", {}, at(6, 8)),
			way("w3", ["n8", "n9", "n10", "n11", "n8"], {
				indoor: "room",
				level: "0",
			}),
		]);
		const floor = unmappedFloorAt(features(g), at(5, 5), 0);
		if (!floor) throw new Error("no floor");
		expect(floor.rings).toHaveLength(2);
		const { graph, select } = mapFloor(g, floor, {});
		const multipolygon = getEntity(
			graph,
			select[0] as `r${number}`,
			"relation",
		);
		expect(multipolygon.tags).toEqual({
			type: "multipolygon",
			indoor: "area",
			level: "0",
		});
		const [outer, inner] = multipolygon.members;
		expect(outer?.role).toBe("outer");
		expect(inner).toEqual({ ref: "w3", role: "inner" });
		const outerWay = getEntity(graph, outer?.ref as Way["id"], "way");
		expect(outerWay.tags).toEqual({});
		expect(corners(graph, outerWay.id)).toEqual(
			new Set(["n5", "n2", "n3", "n4", "n7", "n6"]),
		);
	});

	it("leaves a building outline alone", () => {
		const g = Graph.fromEntities([
			node("n1", {}, at(0, 0)),
			node("n2", {}, at(10, 0)),
			node("n3", {}, at(10, 10)),
			node("n4", {}, at(0, 10)),
			way("w1", ["n1", "n2", "n3", "n4", "n1"], { building: "yes" }),
			node("n8", {}, at(8, 6)),
			node("n9", {}, at(12, 6)),
			node("n10", {}, at(12, 8)),
			node("n11", {}, at(8, 8)),
			way("w3", ["n8", "n9", "n10", "n11", "n8"], {
				indoor: "room",
				level: "0",
			}),
		]);
		const floor = unmappedFloorAt(features(g), at(5, 5), 0);
		if (!floor) throw new Error("no floor");
		const { graph } = mapFloor(g, floor, {});
		expect(getEntity(graph, "w1", "way").nodes).toEqual([
			"n1",
			"n2",
			"n3",
			"n4",
			"n1",
		]);
		expect(getEntity(graph, "w3", "way").nodes).toHaveLength(7);
	});
});

const byY = (graph: Graph) => (a: NodeId, b: NodeId) =>
	getEntity(graph, a, "node").loc[1] - getEntity(graph, b, "node").loc[1];
