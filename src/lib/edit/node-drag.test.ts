import { describe, expect, it } from "vitest";
import type { Message } from "#lib/i18n/messages.ts";
import { msg } from "#lib/i18n/messages.ts";
import type { SnapTarget } from "#lib/map/snap.ts";
import type { Loc, NodeId } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { EditHistory } from "#lib/state/edit-history.svelte.ts";
import type { MapPoint } from "./mode.ts";
import { movesHint, nodeDrag } from "./node-drag.ts";

const at = (lon: number, lat: number): MapPoint => ({
	point: { x: 0, y: 0 },
	lngLat: [lon, lat],
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
});

/** Two rooms on levels 0 and 1 sharing the side n2–n3, and a wall n7–n8 to the right. */
const graph = () =>
	Graph.fromEntities([
		node("n1", {}, [0, 0]),
		node("n2", {}, [1, 0]),
		node("n3", {}, [1, 1]),
		node("n4", {}, [0, 1]),
		node("n5", {}, [2, 0]),
		node("n6", {}, [2, 1]),
		node("n7", {}, [3, 0]),
		node("n8", {}, [3, 1]),
		way("w1", ["n1", "n2", "n3", "n4", "n1"], { indoor: "room", level: "0" }),
		way("w2", ["n2", "n5", "n6", "n3", "n2"], { indoor: "room", level: "1" }),
		way("w3", ["n7", "n8"], { indoor: "wall", level: "0" }),
	]);

function setup(snapTo: (at: MapPoint) => SnapTarget | null = () => null) {
	const history = new EditHistory(graph());
	const hints: (Message | null)[] = [];
	const excluded: NodeId[][] = [];
	const options = {
		history,
		snap: (point: MapPoint, exclude: ReadonlySet<NodeId>) => {
			excluded.push([...exclude]);
			return snapTo(point);
		},
		onhint: (hint: Message | null) => hints.push(hint),
	};
	return { history, hints, excluded, options };
}

const locOf = (history: EditHistory, id: NodeId): Loc | undefined => {
	const n = history.graph.entity(id);
	return n?.type === "node" ? n.loc : undefined;
};

describe("nodeDrag: a vertex", () => {
	it("moves the node live, then makes one undo step where released", () => {
		const { history, options } = setup();
		const drag = nodeDrag({ kind: "vertex", id: "n1" }, options);
		drag.move(at(-1, 0));
		expect(locOf(history, "n1")).toEqual([-1, 0]);
		expect(history.canUndo).toBe(false);
		drag.end(at(-2, 0));
		expect(locOf(history, "n1")).toEqual([-2, 0]);
		history.undo();
		expect(locOf(history, "n1")).toEqual([0, 0]);
		expect(history.canUndo).toBe(false);
	});

	it("leaves everything as it was when cancelled", () => {
		const { history, hints, options } = setup();
		const drag = nodeDrag({ kind: "vertex", id: "n2" }, options);
		drag.move(at(5, 5));
		drag.cancel();
		expect(locOf(history, "n2")).toEqual([1, 0]);
		expect(history.canUndo).toBe(false);
		expect(hints.at(-1)).toBeNull();
	});

	it("snaps leaving out the dragged node", () => {
		const { excluded, options } = setup();
		nodeDrag({ kind: "vertex", id: "n4" }, options).move(at(0, 2));
		expect(excluded).toEqual([["n4"]]);
	});

	it("joins the node it is dropped on: the wall's end becomes the room's corner", () => {
		const { history, options } = setup(() => ({
			kind: "node",
			id: "n6",
			loc: [2, 1],
		}));
		nodeDrag({ kind: "vertex", id: "n8" }, options).end(at(2.01, 1));
		expect(history.graph.entity("w3")).toMatchObject({ nodes: ["n7", "n6"] });
		expect(history.graph.entity("n8")).toBeUndefined();
	});

	it("becomes a vertex of the side it is dropped on", () => {
		const { history, options } = setup(() => ({
			kind: "segment",
			segment: {
				way: "w2",
				a: { id: "n5", loc: [2, 0] },
				b: { id: "n6", loc: [2, 1] },
			},
			loc: [2, 0.5],
		}));
		nodeDrag({ kind: "vertex", id: "n7" }, options).end(at(2.01, 0.5));
		expect(history.graph.entity("w2")).toMatchObject({
			nodes: ["n2", "n5", "n7", "n6", "n3", "n2"],
		});
		expect(locOf(history, "n7")).toEqual([2, 0.5]);
	});

	it("only moves onto its own way's side, without crossing itself", () => {
		const { history, options } = setup(() => ({
			kind: "segment",
			segment: {
				way: "w1",
				a: { id: "n3", loc: [1, 1] },
				b: { id: "n4", loc: [0, 1] },
			},
			loc: [0.5, 1],
		}));
		nodeDrag({ kind: "vertex", id: "n1" }, options).end(at(0.5, 1));
		expect(history.graph.entity("w1")).toMatchObject({
			nodes: ["n1", "n2", "n3", "n4", "n1"],
		});
		expect(locOf(history, "n1")).toEqual([0.5, 1]);
	});
});

describe("nodeDrag: a midpoint", () => {
	it("adds a vertex to every way sharing the side, in one step", () => {
		const { history, options } = setup();
		const drag = nodeDrag(
			{ kind: "midpoint", way: "w1", a: "n2", b: "n3" },
			options,
		);
		drag.move(at(1.2, 0.5));
		drag.end(at(1.5, 0.5));
		const [id] = history.graph.changes().created.map((e) => e.id);
		expect(history.graph.entity("w1")).toMatchObject({
			nodes: ["n1", "n2", id, "n3", "n4", "n1"],
		});
		expect(history.graph.entity("w2")).toMatchObject({
			nodes: ["n2", "n5", "n6", "n3", id, "n2"],
		});
		history.undo();
		expect(history.graph.hasChanges()).toBe(false);
	});
});

describe("movesHint", () => {
	it("says how many features on which levels a shared vertex moves", () => {
		expect(movesHint(graph(), "n2")).toEqual(
			msg("drag_moves_features", { count: 2, levels: "0;1" }),
		);
	});

	it("says nothing for a vertex of one way", () => {
		expect(movesHint(graph(), "n1")).toBeNull();
	});
});
