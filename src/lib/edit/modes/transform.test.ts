import { describe, expect, it } from "vitest";
import type { SnapTarget } from "#lib/edit/precision/snap.ts";
import type { EntityId, Loc, NodeId } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { fromLocal, local } from "#lib/osm/geometry.ts";
import { Graph } from "#lib/osm/graph.ts";
import { EditHistory } from "#lib/state/edit-history.svelte.ts";
import type { MapPoint } from "../mode.ts";
import type { DrawSnap } from "./draw.ts";
import { type TransformTool, transformMode } from "./transform.ts";

const O: Loc = [11.575, 48.137];
const loc = (east: number, north: number) => fromLocal(O, [east, north]);
const at = (east: number, north: number): MapPoint => ({
	point: { x: east, y: -north },
	lngLat: loc(east, north),
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
});
const key = (k: string) =>
	({ key: k, ctrlKey: false, metaKey: false, altKey: false }) as KeyboardEvent;
const round = (v: number) => Math.round(v * 1000) / 1000 + 0;

/** A 4 × 3 m room with its south-west corner at O. */
const room = () =>
	Graph.fromEntities([
		node("n1", {}, loc(0, 0)),
		node("n2", {}, loc(4, 0)),
		node("n3", {}, loc(4, 3)),
		node("n4", {}, loc(0, 3)),
		way("w1", ["n1", "n2", "n3", "n4", "n1"], { indoor: "room" }),
	]);
const NODES = new Set<NodeId>(["n1", "n2", "n3", "n4"]);

function corners(history: EditHistory, id: EntityId = "w1") {
	const w = history.graph.entity(id);
	if (w?.type !== "way") return [];
	return w.nodes.slice(0, -1).map((n) => {
		const e = history.graph.entity(n);
		return e?.type === "node" ? local(O, e.loc).map(round) : [];
	});
}

function setup(tool: TransformTool, snap: DrawSnap = () => null) {
	const history = new EditHistory(room());
	const finished: (readonly EntityId[] | null)[] = [];
	const mode = transformMode({
		tool,
		history,
		ids: ["w1"],
		nodes: NODES,
		snap,
		precision: {
			frameAt: (l) => ({ origin: l, angle: 0 }),
			step: () => null,
			units: () => "metric",
			show: () => {},
		},
		onfinish: (select) => finished.push(select),
	});
	const type = (...keys: string[]) => {
		for (const k of keys) expect(mode.key?.(key(k))).toBe(true);
	};
	return { history, finished, mode, type };
}

describe("transformMode", () => {
	it("move: a base point, then a typed distance towards the pointer, in one step", () => {
		const { history, finished, mode, type } = setup("move");
		mode.click?.(at(0, 0));
		mode.hover?.(at(0, 10));
		type("2", ".", "5", "Enter");
		expect(corners(history)[0]).toEqual([0, 2.5]);
		expect(history.canUndo).toBe(true);
		history.undo();
		expect(corners(history)[0]).toEqual([0, 0]);
		expect(finished).toEqual([null]);
	});

	it("rotate: centre, reference, then a typed angle", () => {
		const { history, mode, type } = setup("rotate");
		mode.click?.(at(0, 0));
		mode.click?.(at(4, 0));
		mode.hover?.(at(1, 1));
		type("9", "0", "Enter");
		expect(corners(history)[1]).toEqual([0, 4]);
	});

	it("scale: the pointer's distance against the reference gives the factor", () => {
		const { history, mode } = setup("scale");
		mode.click?.(at(0, 0));
		mode.click?.(at(4, 0));
		mode.click?.(at(8, 0));
		expect(corners(history)[2]).toEqual([8, 6]);
	});

	it("side: a click on a side, then a typed distance towards the pointer", () => {
		const east: SnapTarget = {
			kind: "segment",
			segment: {
				way: "w1",
				a: { id: "n3", loc: loc(4, 3) },
				b: { id: "n2", loc: loc(4, 0) },
			},
			loc: loc(4, 1.5),
		};
		const { history, mode, type } = setup("side", (p) =>
			p.lngLat === at(4, 1.5).lngLat || round(local(O, p.lngLat)[0]) === 4
				? east
				: null,
		);
		mode.click?.(at(4, 1.5));
		mode.hover?.(at(6, 1));
		type("1", "Enter");
		expect(corners(history)).toEqual([
			[0, 0],
			[5, 0],
			[5, 3],
			[0, 3],
		]);
	});

	it("offset: a parallel copy through the pointer, inside, selected after", () => {
		const { history, finished, mode } = setup("offset");
		mode.click?.(at(1, 1.5));
		const [made] = finished[0] ?? [];
		expect(made).toBeDefined();
		expect(corners(history, made)).toEqual([
			[1, 1],
			[3, 1],
			[3, 2],
			[1, 2],
		]);
	});

	it("Escape takes back the last click, then leaves without an edit", () => {
		const { history, finished, mode } = setup("rotate");
		mode.click?.(at(0, 0));
		mode.click?.(at(4, 0));
		mode.key?.(key("Escape"));
		mode.key?.(key("Escape"));
		expect(finished).toEqual([]);
		mode.key?.(key("Escape"));
		expect(finished).toEqual([null]);
		expect(history.canUndo).toBe(false);
	});
});
