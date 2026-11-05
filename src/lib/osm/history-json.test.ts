import { describe, expect, it } from "vitest";
import { node, way } from "./fixtures.ts";
import { Graph } from "./graph.ts";
import { History } from "./history.ts";
import { restoreHistory, saveHistory } from "./history-json.ts";

/** A history over two benches and a path: n1 moved, n-1 added, n2 deleted, the delete undone. */
function edited() {
	const history = new History(
		Graph.fromEntities([
			node("n1", { amenity: "bench" }),
			node("n2", { amenity: "bench" }),
			node("n3"),
			way("w1", ["n1", "n3"], { highway: "footway" }),
		]),
	);
	history.perform(
		(g) => g.replace(node("n1", { amenity: "bench" }, [1, 1])),
		"Move",
	);
	history.select(["n1"]);
	history.perform((g) => {
		const id = g.newId("node");
		return g.replace({
			type: "node",
			id,
			tags: { amenity: "toilets" },
			loc: [2, 2],
		});
	}, "Add point");
	history.select(["n-1"]);
	history.perform((g) => g.remove("n2"), "Delete");
	history.select([]);
	history.undo();
	return history;
}

/** Saved, sent through JSON (as IndexedDB or a file would keep it) and restored. */
function roundTrip<A>(history: History<A>): History<A> {
	return restoreHistory<A>(JSON.parse(JSON.stringify(saveHistory(history))));
}

describe("saveHistory and restoreHistory", () => {
	it("give back the current graph, with the step it was on", () => {
		const restored = roundTrip(edited());

		expect(restored.graph.entity("n1")).toEqual(
			node("n1", { amenity: "bench" }, [1, 1]),
		);
		expect(restored.graph.entity("n-1")).toEqual({
			type: "node",
			id: "n-1",
			tags: { amenity: "toilets" },
			loc: [2, 2],
		});
		expect(restored.graph.entity("n2")).toEqual(
			node("n2", { amenity: "bench" }),
		);
		expect(restored.graph.changeCount()).toBe(2);
	});

	it("give back every step to undo and redo, with its label", () => {
		const restored = roundTrip(edited());

		expect(restored.redo()).toBe("Delete");
		expect(restored.graph.entity("n2")).toBeUndefined();
		expect(restored.undo()).toBe("Delete");
		expect(restored.undo()).toBe("Add point");
		expect(restored.graph.entity("n-1")).toBeUndefined();
		expect(restored.undo()).toBe("Move");
		expect(restored.graph.entity("n1")).toEqual(
			node("n1", { amenity: "bench" }),
		);
		expect(restored.canUndo).toBe(false);
	});

	it("give back what each step had selected", () => {
		const restored = roundTrip(edited());

		expect(restored.selected).toEqual(["n-1"]);
		restored.undo();
		expect(restored.selected).toEqual(["n1"]);
		restored.redo();
		restored.redo();
		expect(restored.selected).toEqual([]);
	});

	it("keep only the downloaded versions of edited entities, as the base", () => {
		const saved = saveHistory(edited());

		expect(saved.base.map((e) => e.id).sort()).toEqual(["n1", "n2"]);
		expect(restoreHistory(saved).base.entity("n1")).toEqual(
			node("n1", { amenity: "bench" }),
		);
	});

	it("report a newer server version of an edited entity as a conflict after restoring", () => {
		const restored = roundTrip(edited());

		const { conflicts } = restored.merge([
			{ ...node("n1", { amenity: "bench" }), version: 2 },
			{ ...node("n3"), version: 2, tags: { barrier: "bollard" } },
		]);

		expect(conflicts).toEqual(["n1"]);
		expect(restored.graph.entity("n1")).toEqual(
			node("n1", { amenity: "bench" }, [1, 1]),
		);
		expect(restored.graph.entity("n3")?.tags).toEqual({ barrier: "bollard" });
	});

	it("give new entities ids no restored entity has", () => {
		const restored = roundTrip(edited());

		expect(restored.graph.newId("node")).toBe("n-2");
	});

	it("restore a history without edits", () => {
		const restored = roundTrip(new History(Graph.fromEntities([node("n1")])));

		expect(restored.graph.hasChanges()).toBe(false);
		expect(restored.canUndo).toBe(false);
	});
});
