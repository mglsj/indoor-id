import { describe, expect, it } from "vitest";
import type { SnapTarget } from "#lib/map/snap.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { WayDrawing } from "./draw-way.ts";

/** A wall n1–n2 on level 0 and a door n3 elsewhere. */
const graph = () =>
	Graph.fromEntities([
		node("n1", {}, [0, 0]),
		node("n2", {}, [2, 0]),
		node("n3", { door: "yes" }, [5, 5]),
		way("w1", ["n1", "n2"], { indoor: "wall", level: "0" }),
	]);

const onNode = (id: "n1" | "n2" | "n3"): SnapTarget => ({
	kind: "node",
	id,
	loc: [0, 0],
});

describe("WayDrawing: a line", () => {
	it("draws through new and existing nodes, tagged with the level", () => {
		const g = graph();
		const drawing = new WayDrawing(g, "line", 1);
		expect(drawing.click(g, [0, 1], null)).toBe("added");
		expect(drawing.canFinish).toBe(false);
		expect(drawing.click(g, [0, 0], onNode("n1"))).toBe("added");
		expect(drawing.canFinish).toBe(true);

		const after = drawing.action()(g);
		const way = after.entity(drawing.wayId);
		expect(way).toMatchObject({
			type: "way",
			tags: { level: "1" },
			nodes: [drawing.nodes[0], "n1"],
		});
		expect(after.entity(drawing.nodes[0] ?? "n0")).toMatchObject({
			loc: [0, 1],
			tags: {},
		});
	});

	it("puts a corner snapped onto a side into that side's ways", () => {
		const g = graph();
		const drawing = new WayDrawing(g, "line", 0);
		drawing.click(g, [1, 0.01], {
			kind: "segment",
			segment: {
				way: "w1",
				a: { id: "n1", loc: [0, 0] },
				b: { id: "n2", loc: [2, 0] },
			},
			loc: [1, 0],
		});
		drawing.click(g, [1, 1], null);
		const after = drawing.action()(g);
		const [corner] = drawing.nodes;
		expect(after.entity("w1")).toMatchObject({ nodes: ["n1", corner, "n2"] });
		expect(after.entity(corner ?? "n0")).toMatchObject({ loc: [1, 0] });
	});

	it("follows the pointer in previews, without keeping it", () => {
		const g = graph();
		const drawing = new WayDrawing(g, "line", 0);
		// One corner and the pointer: already a line.
		drawing.click(g, [0, 1], null);
		const preview = drawing.action([3, 3])(g);
		expect(preview.entity(drawing.wayId)).toMatchObject({
			nodes: [drawing.nodes[0], drawing.cursorId],
		});
		expect(drawing.action()(g).entity(drawing.wayId)).toBeUndefined();
	});

	it("finishes on the last corner, ignores the others, and takes corners back", () => {
		const g = graph();
		const drawing = new WayDrawing(g, "line", 0);
		drawing.click(g, [0, 0], onNode("n1"));
		expect(drawing.click(g, [0, 0], onNode("n1"))).toBe("ignored");
		drawing.click(g, [2, 0], onNode("n2"));
		drawing.click(g, [3, 3], null);
		expect(drawing.click(g, [0, 0], onNode("n1"))).toBe("ignored");
		expect(drawing.undoLast()).toBe(true);
		expect(drawing.click(g, [2, 0], onNode("n2"))).toBe("finish");
	});
});

describe("WayDrawing: an area", () => {
	it("closes once it has three corners, finishing on the first", () => {
		const g = graph();
		const drawing = new WayDrawing(g, "area", 0);
		drawing.click(g, [0, 0], onNode("n1"));
		drawing.click(g, [2, 0], onNode("n2"));
		expect(drawing.click(g, [0, 0], onNode("n1"))).toBe("ignored");
		drawing.click(g, [1, 1], null);
		expect(drawing.click(g, [0, 0], onNode("n1"))).toBe("finish");
		const way = drawing.action()(g).entity(drawing.wayId);
		expect(way).toMatchObject({
			nodes: ["n1", "n2", drawing.nodes[2], "n1"],
			tags: { area: "yes", level: "0" },
		});
	});
});
