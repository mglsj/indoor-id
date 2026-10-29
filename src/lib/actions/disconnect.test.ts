import { describe, expect, it } from "vitest";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { canDisconnect, disconnect } from "./disconnect.ts";

/** A building n1–n2–n3–n4 and a room sharing its side n1–n2. */
const graph = () =>
	Graph.fromEntities([
		node("n1", { door: "yes" }, [0, 0]),
		node("n2", {}, [2, 0]),
		node("n3", {}, [2, 2]),
		node("n4", {}, [0, 2]),
		node("n5", {}, [1, 1]),
		way("w1", ["n1", "n2", "n3", "n4", "n1"], { building: "yes" }),
		way("w2", ["n1", "n2", "n5", "n1"], { indoor: "room" }),
	]);

describe("disconnect", () => {
	it("gives each other way its own copy of a shared vertex, tags left on the original", () => {
		const after = disconnect("n1")(graph());
		expect(after.entity("w1")).toMatchObject({
			nodes: ["n1", "n2", "n3", "n4", "n1"],
		});
		const room = after.entity("w2");
		const copy = room?.type === "way" ? room.nodes[0] : undefined;
		expect(copy).not.toBe("n1");
		expect(room).toMatchObject({ nodes: [copy, "n2", "n5", copy] });
		expect(after.entity(copy ?? "n0")).toMatchObject({ loc: [0, 0], tags: {} });
	});

	it("detaches a way from every way it shares nodes with", () => {
		const after = disconnect("w2")(graph());
		const room = after.entity("w2");
		const nodes = room?.type === "way" ? room.nodes : [];
		expect(nodes[2]).toBe("n5");
		expect(nodes[0]).toBe(nodes[3]);
		expect(nodes).not.toContain("n1");
		expect(nodes).not.toContain("n2");
		expect(after.parentWays("n1").map((w) => w.id)).toEqual(["w1"]);
	});

	it("is only available for what is connected", () => {
		expect(canDisconnect(graph(), "n1")).toBe(true);
		expect(canDisconnect(graph(), "n5")).toBe(false);
		expect(canDisconnect(graph(), "w2")).toBe(true);
		expect(canDisconnect(disconnect("w2")(graph()), "w2")).toBe(false);
	});
});
