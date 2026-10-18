import { describe, expect, it } from "vitest";
import type { Node } from "./entity.ts";
import { Graph } from "./graph.ts";
import { History } from "./history.ts";

const bench: Node = {
	type: "node",
	id: "n1",
	version: 1,
	tags: {},
	loc: [0, 0],
};
const retag = (tags: Record<string, string>) => (graph: Graph) =>
	graph.replace({ ...bench, tags });

describe("History", () => {
	it("applies actions and undoes and redoes them in order", () => {
		const history = new History(Graph.fromEntities([bench]));
		history.perform(retag({ amenity: "bench" }), "Tag as bench");
		history.perform(retag({ amenity: "chair" }), "Tag as chair");

		expect(history.graph.entity("n1")?.tags).toEqual({ amenity: "chair" });
		expect(history.undo()).toBe("Tag as chair");
		expect(history.graph.entity("n1")?.tags).toEqual({ amenity: "bench" });
		expect(history.undo()).toBe("Tag as bench");
		expect(history.graph.entity("n1")?.tags).toEqual({});
		expect(history.undo()).toBeNull();

		expect(history.redo()).toBe("Tag as bench");
		expect(history.graph.entity("n1")?.tags).toEqual({ amenity: "bench" });
	});

	it("drops the redo stack when a new action is performed", () => {
		const history = new History(Graph.fromEntities([bench]));
		history.perform(retag({ amenity: "bench" }), "Tag as bench");
		history.undo();
		history.perform(retag({ amenity: "chair" }), "Tag as chair");

		expect(history.canRedo).toBe(false);
		expect(history.redo()).toBeNull();
		expect(history.graph.entity("n1")?.tags).toEqual({ amenity: "chair" });
	});

	it("makes a step of a follow-up change with nothing to fold into", () => {
		const history = new History(Graph.fromEntities([bench]));
		history.replace(retag({ amenity: "bench" }), "Retag");
		expect(history.undo()).toBe("Retag");
		expect(history.canUndo).toBe(false);
	});

	it("folds a follow-up change into the last step (iD's replace)", () => {
		const history = new History(Graph.fromEntities([bench]));
		history.perform(retag({ amenity: "bench" }), "Tag as bench");
		history.replace(retag({ amenity: "bench", backrest: "yes" }), "Retag");

		expect(history.graph.entity("n1")?.tags).toEqual({
			amenity: "bench",
			backrest: "yes",
		});
		// One undo takes both away.
		expect(history.undo()).toBe("Tag as bench");
		expect(history.graph.entity("n1")?.tags).toEqual({});
		expect(history.redo()).toBe("Tag as bench");
		expect(history.graph.entity("n1")?.tags).toEqual({
			amenity: "bench",
			backrest: "yes",
		});
	});

	it("adds no undo step for an action that changes nothing", () => {
		const history = new History(Graph.fromEntities([bench]));
		const before = history.graph;
		expect(history.perform((graph) => graph, "Nothing")).toBe(before);
		expect(history.canUndo).toBe(false);
		history.perform(retag({ amenity: "bench" }), "Tag as bench");
		history.perform(retag({ amenity: "bench" }), "Tag as bench again");
		expect(history.undo()).toBe("Tag as bench");
	});

	it("keeps the base graph to compare edits against", () => {
		const history = new History(Graph.fromEntities([bench]));
		history.perform(retag({ amenity: "bench" }), "Tag as bench");
		expect(history.base.entity("n1")?.tags).toEqual({});
		expect(history.hasChanges).toBe(true);
		history.undo();
		expect(history.hasChanges).toBe(false);
	});
});

describe("History.merge", () => {
	const downloaded = (version: number, tags: Record<string, string>): Node => ({
		...bench,
		version,
		tags,
	});

	it("adds downloaded entities to the current graph and to every undo step", () => {
		const history = new History(Graph.fromEntities([bench]));
		history.perform(retag({ amenity: "bench" }), "Tag as bench");
		history.merge([{ ...bench, id: "n2" }]);

		expect(history.graph.entity("n2")).toBeDefined();
		history.undo();
		expect(history.graph.entity("n2")).toBeDefined();
		expect(history.hasChanges).toBe(false);
	});

	it("ignores entities it already has in the same or an older version", () => {
		const history = new History(Graph.fromEntities([{ ...bench, version: 2 }]));
		history.merge([
			downloaded(2, { amenity: "chair" }),
			downloaded(1, { x: "y" }),
		]);
		expect(history.graph.entity("n1")?.tags).toEqual({});
	});

	it("takes newer versions of entities that weren't edited locally", () => {
		const history = new History(Graph.fromEntities([bench]));
		const { conflicts } = history.merge([downloaded(2, { amenity: "chair" })]);
		expect(conflicts).toEqual([]);
		expect(history.graph.entity("n1")).toMatchObject({
			version: 2,
			tags: { amenity: "chair" },
		});
	});

	it("keeps local edits and reports a conflict when the server has a newer version", () => {
		const history = new History(Graph.fromEntities([bench]));
		history.perform(retag({ amenity: "bench" }), "Tag as bench");
		const { conflicts } = history.merge([downloaded(2, { amenity: "chair" })]);

		expect(conflicts).toEqual(["n1"]);
		expect(history.graph.entity("n1")).toMatchObject({
			version: 1,
			tags: { amenity: "bench" },
		});
	});

	it("still undoes and redoes local edits after a merge", () => {
		const history = new History(Graph.fromEntities([bench]));
		history.perform(retag({ amenity: "bench" }), "Tag as bench");
		history.merge([{ ...bench, id: "n2" }]);

		history.undo();
		expect(history.graph.entity("n1")?.tags).toEqual({});
		history.redo();
		expect(history.graph.entity("n1")?.tags).toEqual({ amenity: "bench" });
	});
});
