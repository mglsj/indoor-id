import { describe, expect, it } from "vitest";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { mergeAreas, mergeRefusal } from "./merge-areas.ts";

/**
 * Room w1 (n1 n2 n5 n4, 1 wide) and the larger room w2 (n2 n3 n6 n5, 2 wide) sharing the side
 * n2–n5, with a door n5 also on a wall w3; room w4 elsewhere touching w2 only at n3.
 *
 *   n4 — n5 ———— n6
 *   |  w1 |  w2   |
 *   n1 — n2 ———— n3 — n8
 */
const graph = () =>
	Graph.fromEntities([
		node("n1", {}, [0, 0]),
		node("n2", {}, [1, 0]),
		node("n3", {}, [3, 0]),
		node("n4", {}, [0, 1]),
		node("n5", {}, [1, 1]),
		node("n6", {}, [3, 1]),
		node("n7", {}, [1, 2]),
		node("n8", {}, [4, 0]),
		node("n9", {}, [4, -1]),
		way("w1", ["n1", "n2", "n5", "n4", "n1"], {
			indoor: "room",
			level: "0",
			name: "Small",
		}),
		way("w2", ["n2", "n3", "n6", "n5", "n2"], {
			indoor: "room",
			level: "0",
			ref: "12",
		}),
		way("w3", ["n5", "n7"], { indoor: "wall", level: "0" }),
		way("w4", ["n3", "n8", "n9", "n3"], { indoor: "room", level: "0" }),
	]);

describe("mergeAreas", () => {
	it("joins two rooms sharing a side into the larger one", () => {
		const after = mergeAreas(["w1", "w2"])(graph());
		expect(after.entity("w1")).toBeUndefined();
		const merged = after.entity("w2");
		const nodes = merged?.type === "way" ? merged.nodes : [];
		expect(nodes).toHaveLength(7);
		expect(new Set(nodes)).toEqual(
			new Set(["n1", "n2", "n3", "n4", "n5", "n6"]),
		);
		expect(merged?.tags).toEqual({
			indoor: "room",
			level: "0",
			ref: "12",
			name: "Small",
		});
		// n2 is still used by w2's outline; n5 too, and by the wall.
		expect(after.entity("n2")).toBeDefined();
		expect(after.entity("n5")).toBeDefined();
	});
});

describe("mergeRefusal", () => {
	it("allows rooms with the same kind and level sharing a side", () => {
		expect(mergeRefusal(graph(), ["w1", "w2"])).toBeNull();
	});

	it("refuses rooms on different levels, lone or non-area features", () => {
		const relevelled = graph().replace(
			way("w1", ["n1", "n2", "n5", "n4", "n1"], { indoor: "room", level: "1" }),
		);
		expect(mergeRefusal(relevelled, ["w1", "w2"])).toBe("different_tags");
		expect(mergeRefusal(graph(), ["w1"])).toBe("not_areas");
		expect(mergeRefusal(graph(), ["w1", "w3"])).toBe("not_areas");
	});

	it("refuses rooms that only touch at a corner, or not at all", () => {
		expect(mergeRefusal(graph(), ["w2", "w4"])).toBe("not_adjacent");
		expect(mergeRefusal(graph(), ["w1", "w4"])).toBe("not_adjacent");
	});
});
