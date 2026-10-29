import { describe, expect, it } from "vitest";
import { copyEntities } from "#lib/actions/copy.ts";
import { msg } from "#lib/i18n/messages.ts";
import type { EntityId } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import {
	OPERATIONS,
	type Operation,
	type OperationContext,
} from "./operations.ts";

/** Two square rooms w1 and w2 sharing the side n2–n3, and a toilet n7. */
const graph = () =>
	Graph.fromEntities([
		node("n1", {}, [0, 0]),
		node("n2", {}, [0.001, 0]),
		node("n3", {}, [0.001, 0.001]),
		node("n4", {}, [0, 0.001]),
		node("n5", {}, [0.002, 0]),
		node("n6", {}, [0.002, 0.001]),
		node("n7", { amenity: "toilets", level: "0" }, [0.0005, 0.0005]),
		way("w1", ["n1", "n2", "n3", "n4", "n1"], { indoor: "room", level: "0" }),
		way("w2", ["n2", "n5", "n6", "n3", "n2"], { indoor: "room", level: "0" }),
	]);

const context = (
	selected: EntityId[],
	more: Partial<OperationContext> = {},
): OperationContext => ({
	graph: graph(),
	selected,
	level: 0,
	pasteAt: [1, 1],
	clipboard: null,
	...more,
});

const operation = (id: Operation["id"]) =>
	OPERATIONS.find((o) => o.id === id) as Operation;

/** The operations offered for a selection. */
const offered = (c: OperationContext) =>
	OPERATIONS.filter((o) => o.available(c)).map((o) => o.id);

function apply(id: Operation["id"], c: OperationContext) {
	const result = operation(id).run(c);
	if (result.kind !== "edit") throw new Error("not an edit");
	let select: readonly EntityId[] | null = null;
	const after = c.graph.update((g) => {
		const done = result.edit(g);
		select = done.select;
		return done.graph;
	});
	return { graph: after, select, annotation: result.annotation };
}

describe("OPERATIONS", () => {
	it("offers what applies to the selection", () => {
		expect(offered(context([]))).toEqual([]);
		expect(offered(context(["w1"]))).toEqual([
			"copy",
			"disconnect",
			"square",
			"repeat",
			"delete",
		]);
		expect(offered(context(["n7"]))).toEqual(["copy", "repeat", "delete"]);
		expect(offered(context(["n2"]))).toEqual(["copy", "disconnect", "delete"]);
		expect(offered(context(["w1", "w2"]))).toEqual(["copy", "merge", "delete"]);
		const clipboard = copyEntities(graph(), ["n7"]);
		expect(offered(context([], { clipboard }))).toEqual(["paste"]);
	});

	it("says why one can't run", () => {
		expect(operation("copy").disabled(context(["n2"]))).toEqual(
			msg("operation_copy_nothing"),
		);
		expect(operation("square").disabled(context(["w1"]))).toEqual(
			msg("operation_square_square_enough"),
		);
		expect(operation("merge").disabled(context(["w1", "n7"]))).toEqual(
			msg("operation_merge_not_areas"),
		);
		expect(operation("disconnect").disabled(context(["w1"]))).toBeNull();
		expect(operation("repeat").disabled(context(["w1"], { level: 1 }))).toEqual(
			msg("operation_repeat_not_on_level", { level: 1 }),
		);
		expect(operation("repeat").run(context(["w1"]))).toEqual({
			kind: "repeat",
			id: "w1",
		});
	});

	it("deletes the selection, selecting nothing after", () => {
		const {
			graph: after,
			select,
			annotation,
		} = apply("delete", context(["w1", "n7"]));
		expect(after.entity("w1")).toBeUndefined();
		expect(after.entity("n7")).toBeUndefined();
		// n2 and n3 are still used by w2.
		expect(after.entity("n2")).toBeDefined();
		expect(select).toBeNull();
		expect(annotation).toEqual(msg("undo_delete_many", { count: 2 }));
	});

	it("merges rooms, selecting the one kept", () => {
		const { graph: after, select } = apply("merge", context(["w1", "w2"]));
		expect(select).toHaveLength(1);
		const [kept] = select ?? [];
		const room = after.entity(kept ?? "w0");
		expect(room?.type === "way" && room.nodes).toHaveLength(7);
	});

	it("disconnects a room, keeping it selected", () => {
		const { graph: after, select } = apply("disconnect", context(["w2"]));
		expect(select).toEqual(["w2"]);
		const room = after.entity("w2");
		expect(room?.type === "way" && room.nodes).not.toContain("n2");
	});

	it("copies, then pastes at the pointer on the level shown", () => {
		const copied = operation("copy").run(context(["n7"]));
		if (copied.kind !== "copy") throw new Error("not a copy");
		const {
			graph: after,
			select,
			annotation,
		} = apply(
			"paste",
			context([], { clipboard: copied.clipboard, pasteAt: [5, 5], level: 2 }),
		);
		const [id] = select ?? [];
		const pasted = after.entity(id ?? "n0");
		expect(pasted?.tags).toEqual({ amenity: "toilets", level: "2" });
		const loc = pasted?.type === "node" ? pasted.loc : [0, 0];
		expect(loc[0]).toBeCloseTo(5, 9);
		expect(loc[1]).toBeCloseTo(5, 9);
		expect(annotation).toEqual(msg("undo_paste"));
	});
});
