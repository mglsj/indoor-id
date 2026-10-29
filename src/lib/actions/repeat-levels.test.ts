import { describe, expect, it } from "vitest";
import type { Entity, NodeId } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import {
	canRepeat,
	currentRepeat,
	type NodesOnLevel,
	repeatOnLevels,
} from "./repeat-levels.ts";

/**
 * A lift shaft w1 on level 0 (n1–n4), a corridor w2 on level 1 sharing the position of w1's
 * corner n2 with its own node n12, and a building w9 (no level) using n1.
 */
const building = (extra: Entity[] = []) =>
	Graph.fromEntities([
		node("n1", {}, [0, 0]),
		node("n2", {}, [1, 0]),
		node("n3", {}, [1, 1]),
		node("n4", {}, [0, 1]),
		way("w1", ["n1", "n2", "n3", "n4", "n1"], {
			indoor: "room",
			room: "elevator",
			level: "0",
		}),
		node("n12", {}, [1, 0]),
		node("n13", {}, [3, 0]),
		node("n14", {}, [3, 3]),
		way("w2", ["n12", "n13", "n14", "n12"], { indoor: "corridor", level: "1" }),
		node("n8", {}, [-1, -1]),
		way("w9", ["n1", "n8", "n4", "n1"], { building: "yes" }),
		...extra,
	]);

/** What the feature store would give: nodes drawn on a level, untagged outlines on all. */
function nodesOn(graph: Graph): NodesOnLevel {
	return (level) => {
		const nodes = new Map<
			NodeId,
			{ id: NodeId; loc: readonly [number, number] }
		>();
		for (const e of graph.entities()) {
			if (e.type !== "way") continue;
			if (e.tags.level !== undefined && e.tags.level !== String(level))
				continue;
			for (const n of graph.childNodes(e))
				nodes.set(n.id, { id: n.id, loc: n.loc });
		}
		return [...nodes.values()];
	};
}

const apply = (
	g: Graph,
	method: "copies" | "repeat_on" | "level",
	levels: number[],
	id: "w1" | "n30" = "w1",
) => {
	const near = nodesOn(g);
	const now = currentRepeat(g, id, 0, [0, 1, 2], near);
	return repeatOnLevels(id, 0, { method, levels }, now, near)(g);
};

const copiesOf = (g: Graph) =>
	[...g.entities()].filter(
		(e) => e.type === "way" && e.tags.room === "elevator" && e.id !== "w1",
	);

describe("canRepeat", () => {
	it("repeats points and ways on the level shown", () => {
		const g = building([node("n30", { amenity: "toilets", level: "0" })]);
		expect(canRepeat(g, "w1", 0)).toBe(true);
		expect(canRepeat(g, "n30", 0)).toBe(true);
		expect(canRepeat(g, "w1", 1)).toBe(false);
		// A vertex, and a way without a level.
		expect(canRepeat(g, "n2", 0)).toBe(false);
		expect(canRepeat(g, "w9", 0)).toBe(false);
	});
});

describe("repeatOnLevels", () => {
	it("copies a way onto other levels, sharing the nodes found there", () => {
		const after = apply(building(), "copies", [1, 2]);
		const copies = copiesOf(after);
		expect(copies.map((c) => c.tags.level).sort()).toEqual(["1", "2"]);
		const onOne = copies.find((c) => c.tags.level === "1");
		if (onOne?.type !== "way") throw new Error("no copy");
		// n12 is at n2's position on level 1; n1 is the building's, on every level.
		expect(onOne.nodes[0]).toBe("n1");
		expect(onOne.nodes[1]).toBe("n12");
		expect(onOne.nodes).not.toContain("n3");
		expect(onOne.tags).toEqual({
			indoor: "room",
			room: "elevator",
			level: "1",
		});
		expect(after.entity("w1")).toEqual(building().entity("w1"));
	});

	it("finds the copies already there, and removes the ones left out", () => {
		const once = apply(building(), "copies", [1, 2]);
		const near = nodesOn(once);
		const now = currentRepeat(once, "w1", 0, [0, 1, 2], near);
		expect(now.method).toBe("copies");
		expect(now.levels).toEqual([1, 2]);
		// Asking again changes nothing.
		expect(
			copiesOf(
				repeatOnLevels(
					"w1",
					0,
					{ method: "copies", levels: [1, 2] },
					now,
					near,
				)(once),
			),
		).toHaveLength(2);
		const fewer = repeatOnLevels(
			"w1",
			0,
			{ method: "copies", levels: [1] },
			now,
			near,
		)(once);
		expect(copiesOf(fewer).map((c) => c.tags.level)).toEqual(["1"]);
	});

	it("writes repeat_on, replacing copies", () => {
		const copied = apply(building(), "copies", [1]);
		const after = apply(copied, "repeat_on", [1, 2]);
		expect(after.entity("w1")?.tags).toMatchObject({
			level: "0",
			repeat_on: "1;2",
		});
		expect(copiesOf(after)).toEqual([]);
		expect(currentRepeat(after, "w1", 0, [], nodesOn(after))).toMatchObject({
			method: "repeat_on",
			levels: [1, 2],
		});
	});

	it("writes every level into level, and back to one with copies", () => {
		const after = apply(building(), "level", [2, 1]);
		expect(after.entity("w1")?.tags.level).toBe("0;1;2");
		expect(currentRepeat(after, "w1", 0, [], nodesOn(after))).toMatchObject({
			method: "level",
			levels: [1, 2],
		});
		const back = apply(after, "copies", [1]);
		expect(back.entity("w1")?.tags.level).toBe("0");
		expect(copiesOf(back)).toHaveLength(1);
	});

	it("copies a point", () => {
		const g = building([
			node("n30", { amenity: "toilets", level: "0" }, [5, 5]),
		]);
		const after = apply(g, "copies", [2], "n30");
		const copies = [...after.entities()].filter(
			(e) => e.tags.amenity === "toilets" && e.id !== "n30",
		);
		expect(copies).toHaveLength(1);
		expect(copies[0]).toMatchObject({ loc: [5, 5], tags: { level: "2" } });
	});
});
