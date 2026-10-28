import { describe, expect, it } from "vitest";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { onePerLevel } from "./split-levels.ts";

describe("onePerLevel", () => {
	it("keeps the lowest level on the way and copies it to the others, sharing its nodes", () => {
		const graph = Graph.fromEntities([
			node("n1"),
			node("n2"),
			node("n3"),
			way("w1", ["n1", "n2", "n3", "n1"], {
				indoor: "room",
				level: "0;1;2",
				name: "Office",
			}),
		]);
		const after = onePerLevel("w1", [2, 0, 1])(graph);

		expect(after.entity("w1")?.tags).toEqual({
			indoor: "room",
			level: "0",
			name: "Office",
		});
		const created = after.changes().created;
		expect(created.map((w) => w.tags.level)).toEqual(["1", "2"]);
		for (const copy of created) {
			expect(copy).toMatchObject({
				type: "way",
				nodes: ["n1", "n2", "n3", "n1"],
				tags: { indoor: "room", name: "Office" },
			});
		}
		expect(after.parentWays("n2")).toHaveLength(3);
	});
});
