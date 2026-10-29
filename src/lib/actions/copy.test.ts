import { describe, expect, it } from "vitest";
import { node, relation, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { canCopy, copyEntities, pasteEntities } from "./copy.ts";

/** A room n1–n4 on level 1 with a door n1, a toilet n5 on level 1 and a relation. */
const graph = () =>
	Graph.fromEntities([
		node("n1", { door: "yes", level: "1" }, [0, 0]),
		node("n2", {}, [2, 0]),
		node("n3", {}, [2, 2]),
		node("n4", {}, [0, 2]),
		node("n5", { amenity: "toilets", level: "1" }, [3, 1]),
		way("w1", ["n1", "n2", "n3", "n4", "n1"], { indoor: "room", level: "1" }),
		relation("r1", [{ ref: "w1", role: "" }], { type: "site" }),
	]);

describe("canCopy", () => {
	it("copies points and ways, not vertices or relations", () => {
		const g = graph();
		expect(canCopy(g, "n5")).toBe(true);
		expect(canCopy(g, "w1")).toBe(true);
		expect(canCopy(g, "n1")).toBe(false);
		expect(canCopy(g, "r1")).toBe(false);
	});
});

describe("copyEntities", () => {
	it("keeps what can be copied, with the ways' nodes and the centre of their extent", () => {
		const clipboard = copyEntities(graph(), ["r1", "w1", "n5"]);
		expect(clipboard?.roots.map((e) => e.id)).toEqual(["w1", "n5"]);
		expect([...(clipboard?.nodes.keys() ?? [])]).toEqual([
			"n1",
			"n2",
			"n3",
			"n4",
		]);
		expect(clipboard?.center[0]).toBeCloseTo(1.5, 9);
		// Halfway in Web Mercator, a little north of halfway in latitude.
		expect(clipboard?.center[1]).toBeCloseTo(1.00015, 5);
	});

	it("is null when nothing can be copied", () => {
		expect(copyEntities(graph(), ["n1", "r1"])).toBeNull();
	});

	it("is a snapshot: later edits don't change it", () => {
		const g = graph();
		const clipboard = copyEntities(g, ["w1"]);
		g.replace({ type: "node", id: "n2", loc: [9, 9], tags: {} });
		expect(clipboard?.nodes.get("n2")?.loc).toEqual([2, 0]);
	});
});

describe("pasteEntities", () => {
	it("adds new features centred on the target, the nodes shared once", () => {
		const g = graph();
		const clipboard = copyEntities(g, ["w1"]);
		if (!clipboard) throw new Error("no copy");
		// On the equator a move along it changes longitudes only.
		const moved = { ...clipboard, center: [1, 0] as const };
		const { graph: after, ids } = pasteEntities(g, moved, [11, 0], 1);
		expect(ids).toHaveLength(1);
		const room = after.entity(ids[0] ?? "w0");
		if (room?.type !== "way") throw new Error("no room");
		expect(room.id).not.toBe("w1");
		expect(room.tags).toEqual({ indoor: "room", level: "1" });
		expect(room.nodes).toHaveLength(5);
		expect(room.nodes[0]).toBe(room.nodes[4]);
		expect(room.nodes).not.toContain("n1");
		const locs = after.childNodes(room).map((n) => n.loc);
		expect(locs[0]?.[0]).toBeCloseTo(10, 9);
		expect(locs[1]?.[0]).toBeCloseTo(12, 9);
		expect(locs[2]?.[1]).toBeCloseTo(2, 9);
		const door = after.childNodes(room)[0];
		expect(door?.tags).toEqual({ door: "yes", level: "1" });
		expect(after.entity("w1")).toEqual(g.entity("w1"));
	});

	it("moves a copy on one level onto the level shown", () => {
		const g = graph();
		const clipboard = copyEntities(g, ["w1", "n5"]);
		if (!clipboard) throw new Error("no copy");
		const { graph: after, ids } = pasteEntities(g, clipboard, [1.5, 1], 2);
		const [room, toilet] = ids.map((id) => after.entity(id));
		expect(room?.tags.level).toBe("2");
		expect(toilet?.tags).toEqual({ amenity: "toilets", level: "2" });
		if (room?.type !== "way") throw new Error("no room");
		expect(after.childNodes(room)[0]?.tags.level).toBe("2");
		// Untagged nodes stay untagged.
		expect(after.childNodes(room)[1]?.tags).toEqual({});
	});

	it("keeps the levels of a copy on several levels", () => {
		const g = graph().replace({
			type: "node",
			id: "n5",
			loc: [3, 1],
			tags: { amenity: "toilets", level: "0;1" },
		});
		const clipboard = copyEntities(g, ["w1", "n5"]);
		if (!clipboard) throw new Error("no copy");
		const { graph: after, ids } = pasteEntities(g, clipboard, [5, 5], 3);
		expect(ids.map((id) => after.entity(id)?.tags.level)).toEqual(["1", "0;1"]);
	});
});
