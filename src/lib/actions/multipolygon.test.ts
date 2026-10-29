import { describe, expect, it } from "vitest";
import type { Entity, Relation } from "#lib/osm/entity.ts";
import { node, relation, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { makeMultipolygon, multipolygonRefusal } from "./multipolygon.ts";

/** A room w1 (0–10) with an atrium w2 (4–6) inside it, and a room w3 (20–30) elsewhere. */
const graph = (extra: Entity[] = []) =>
	Graph.fromEntities([
		node("n1", {}, [0, 0]),
		node("n2", {}, [10, 0]),
		node("n3", {}, [10, 10]),
		node("n4", {}, [0, 10]),
		way("w1", ["n1", "n2", "n3", "n4", "n1"], {
			indoor: "room",
			level: "0",
			area: "yes",
		}),
		node("n5", {}, [4, 4]),
		node("n6", {}, [6, 4]),
		node("n7", {}, [6, 6]),
		way("w2", ["n5", "n6", "n7", "n5"], { level: "0", area: "yes" }),
		node("n8", {}, [20, 0]),
		node("n9", {}, [30, 0]),
		node("n10", {}, [30, 10]),
		way("w3", ["n8", "n9", "n10", "n8"], { indoor: "room", level: "0" }),
		...extra,
	]);

describe("makeMultipolygon", () => {
	it("makes a room with a hole, the room's tags moving to the relation", () => {
		const result = makeMultipolygon(graph(), ["w2", "w1"]);
		if (!result) throw new Error("refused");
		const mp = result.graph.entity(result.relation) as Relation;
		expect(mp.tags).toEqual({
			type: "multipolygon",
			indoor: "room",
			level: "0",
		});
		expect(mp.members).toEqual([
			{ ref: "w2", role: "inner" },
			{ ref: "w1", role: "outer" },
		]);
		expect(result.graph.entity("w1")?.tags).toEqual({});
		// The hole was just drawn: its drawing tags go.
		expect(result.graph.entity("w2")?.tags).toEqual({});
	});

	it("keeps the tags on the ways when the outer ways differ", () => {
		const g = graph().replace({
			type: "way",
			id: "w3",
			nodes: ["n8", "n9", "n10", "n8"],
			tags: { indoor: "corridor", level: "0" },
		});
		const result = makeMultipolygon(g, ["w1", "w3"]);
		if (!result) throw new Error("refused");
		expect(result.graph.entity(result.relation)?.tags).toEqual({
			type: "multipolygon",
		});
		expect(result.graph.entity("w1")?.tags.indoor).toBe("room");
	});

	it("adds a hole to a selected multipolygon", () => {
		const g = graph([
			relation("r1", [{ ref: "w1", role: "outer" }], {
				type: "multipolygon",
				indoor: "room",
			}),
		]);
		const result = makeMultipolygon(g, ["r1", "w2"]);
		if (!result) throw new Error("refused");
		expect(result.relation).toBe("r1");
		expect((result.graph.entity("r1") as Relation).members).toEqual([
			{ ref: "w1", role: "outer" },
			{ ref: "w2", role: "inner" },
		]);
	});
});

describe("multipolygonRefusal", () => {
	it("needs closed ways, two at least, or one and a multipolygon", () => {
		expect(multipolygonRefusal(graph(), ["w1"])).toBe("not_rings");
		expect(multipolygonRefusal(graph(), ["w1", "n1"])).toBe("not_rings");
		expect(multipolygonRefusal(graph(), ["w1", "w2"])).toBeNull();
	});

	it("refuses two multipolygons, and a ring of another one", () => {
		const g = graph([
			relation("r1", [{ ref: "w1", role: "outer" }], { type: "multipolygon" }),
			relation("r2", [{ ref: "w3", role: "outer" }], { type: "multipolygon" }),
		]);
		expect(multipolygonRefusal(g, ["r1", "r2", "w2"])).toBe(
			"several_relations",
		);
		expect(multipolygonRefusal(g, ["r1", "w3"])).toBe("in_other_multipolygon");
	});
});
