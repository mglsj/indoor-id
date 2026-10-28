import { describe, expect, it } from "vitest";
import { node, relation, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { connectNodes, connectRefusal } from "./connect.ts";

/** A room n1–n2–n3–n4 and a wall n5–n6 whose end n5 is dropped on the room's corner n1. */
const rooms = () =>
	Graph.fromEntities([
		node("n1"),
		node("n2", {}, [1, 0]),
		node("n3", {}, [1, 1]),
		node("n4", {}, [0, 1]),
		node("n5", {}, [0.001, 0]),
		node("n6", {}, [-1, 0]),
		way("w1", ["n1", "n2", "n3", "n4", "n1"], { indoor: "room" }),
		way("w2", ["n5", "n6"], { indoor: "wall" }),
	]);

describe("connectNodes", () => {
	it("makes the ways of the dropped node use the one it was dropped on", () => {
		const after = connectNodes("n5", "n1")(rooms());

		expect(after.entity("w2")).toMatchObject({ nodes: ["n1", "n6"] });
		expect(after.entity("n5")).toBeUndefined();
		expect(after.entity("n1")).toMatchObject({ loc: [0, 0] });
		expect(
			after
				.parentWays("n1")
				.map((w) => w.id)
				.sort(),
		).toEqual(["w1", "w2"]);
	});

	it("keeps the tags of the dropped node when the other has none", () => {
		const graph = rooms().replace(node("n5", { door: "hinged" }, [0.001, 0]));
		const after = connectNodes("n5", "n1")(graph);
		expect(after.entity("n1")?.tags).toEqual({ door: "hinged" });
	});

	it("moves relation memberships to the remaining node", () => {
		const graph = rooms().replace(
			relation("r1", [{ ref: "n5", role: "via" }], { type: "route" }),
		);
		const after = connectNodes("n5", "n1")(graph);
		expect(after.entity("r1")).toMatchObject({
			members: [{ ref: "n1", role: "via" }],
		});
	});

	it("drops a corner joined into its neighbour, the node never twice in a row", () => {
		const after = connectNodes("n2", "n1")(rooms());
		expect(after.entity("w1")).toMatchObject({
			nodes: ["n1", "n3", "n4", "n1"],
		});
	});
});

describe("connectRefusal", () => {
	it("allows joining an untagged node, or two with the same tags", () => {
		expect(connectRefusal(rooms(), "n5", "n1")).toBeNull();
		const doors = rooms()
			.replace(node("n5", { door: "yes" }))
			.replace(node("n1", { door: "yes" }));
		expect(connectRefusal(doors, "n5", "n1")).toBeNull();
	});

	it("refuses two nodes with different tags", () => {
		const graph = rooms()
			.replace(node("n5", { door: "hinged" }))
			.replace(node("n1", { door: "sliding" }));
		expect(connectRefusal(graph, "n5", "n1")).toBe("tags");
	});

	it("refuses when an area would keep fewer than three corners, a line fewer than two nodes", () => {
		const triangle = Graph.fromEntities([
			node("n1"),
			node("n2"),
			node("n3"),
			way("w1", ["n1", "n2", "n3", "n1"]),
		]);
		expect(connectRefusal(triangle, "n2", "n1")).toBe("collapses");
		expect(connectRefusal(rooms(), "n6", "n5")).toBe("collapses");
	});
});
