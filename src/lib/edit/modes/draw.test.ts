import { describe, expect, it } from "vitest";
import type { Feedback } from "#lib/edit/precision/feedback.ts";
import { Inferences } from "#lib/edit/precision/inference.ts";
import type { SnapTarget } from "#lib/edit/precision/snap.ts";
import type { EntityId } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { fromLocal, local } from "#lib/osm/geometry.ts";
import { Graph } from "#lib/osm/graph.ts";
import { EditHistory } from "#lib/state/edit-history.svelte.ts";
import type { MapPoint } from "../mode.ts";
import {
	type DrawSnap,
	drawPointMode,
	drawWayMode,
	type SnapConstraints,
} from "./draw.ts";

const at = (lon: number, lat: number): MapPoint => ({
	point: { x: lon, y: lat },
	lngLat: [lon, lat],
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
});
const key = (k: string) =>
	({ key: k, ctrlKey: false, metaKey: false, altKey: false }) as KeyboardEvent;
/** Ctrl+Z, or ⌘Z on a Mac (the tests may run on either). */
const undoKey = (shift = false) =>
	({
		key: "z",
		ctrlKey: !/Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? ""),
		metaKey: /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? ""),
		shiftKey: shift,
		altKey: false,
	}) as KeyboardEvent;

/** A room on level 0. */
const graph = () =>
	Graph.fromEntities([
		node("n1", {}, [0, 0]),
		node("n2", {}, [2, 0]),
		node("n3", {}, [2, 2]),
		way("w1", ["n1", "n2", "n3", "n1"], { indoor: "room", level: "0" }),
	]);

function setup(snapTo: (p: MapPoint) => SnapTarget | null = () => null) {
	const history = new EditHistory(graph());
	const finished: (EntityId | null)[] = [];
	const options = {
		history,
		level: 1,
		snap: snapTo,
		onfinish: (id: EntityId | null) => finished.push(id),
	};
	return { history, finished, options };
}

describe("drawWayMode", () => {
	it("draws a line click by click, finished with Enter in one undo step", () => {
		const { history, finished, options } = setup();
		const mode = drawWayMode("line", options);
		mode.click?.(at(5, 5));
		mode.hover?.(at(6, 6));
		mode.click?.(at(7, 5));
		expect(history.canUndo).toBe(false);
		expect(mode.key?.(key("Enter"))).toBe(true);

		const [id] = finished;
		expect(history.graph.entity(id ?? "w0")).toMatchObject({
			tags: { level: "1" },
		});
		expect(history.graph.changes().created).toHaveLength(3);
		history.undo();
		expect(history.graph.hasChanges()).toBe(false);
	});

	it("shows the side to the pointer while drawing", () => {
		const { history, options } = setup();
		const mode = drawWayMode("line", options);
		mode.click?.(at(5, 5));
		expect(mode.hover?.(at(6, 6))).toBe("crosshair");
		const drawn = history.graph.changes().created.find((e) => e.type === "way");
		expect(drawn?.type === "way" && drawn.nodes).toHaveLength(2);
	});

	it("takes the last corner back with Backspace, and stops with Escape when too short", () => {
		const { history, finished, options } = setup();
		const mode = drawWayMode("area", options);
		mode.click?.(at(5, 5));
		mode.click?.(at(6, 5));
		mode.key?.(key("Backspace"));
		mode.key?.(key("Escape"));
		expect(finished).toEqual([null]);
		expect(history.graph.hasChanges()).toBe(false);
	});

	it("closes an area on its first corner, tagged area=yes for its type to be picked", () => {
		let first: SnapTarget | null = null;
		const { history, finished, options } = setup((p) =>
			p.lngLat[0] === 5 && first ? first : null,
		);
		const mode = drawWayMode("area", options);
		mode.click?.(at(5, 5));
		const [corner] = history.graph.changes().created;
		first = { kind: "node", id: corner?.id as `n${number}`, loc: [5, 5] };
		mode.click?.(at(6, 5));
		mode.click?.(at(6, 6));
		mode.click?.(at(5, 5));
		const area = history.graph.entity(finished[0] ?? "w0");
		expect(area).toMatchObject({ tags: { area: "yes", level: "1" } });
		expect(area?.type === "way" && area.nodes.at(-1)).toBe(corner?.id);
	});

	it("takes the last corner back with Mod+Z, and stops once none is left", () => {
		const { history, finished, options } = setup(() => null);
		history.setTags("n1", { entrance: "yes" });
		const mode = drawWayMode("line", options);
		mode.click?.(at(5, 5));
		mode.click?.(at(6, 5));
		expect(mode.key?.(undoKey())).toBe(true);
		mode.key?.(key("Enter"));
		// One corner left: too short for a line, so Enter stopped it, and nothing was undone.
		expect(finished).toEqual([null]);
		expect(history.graph.entity("n1")?.tags).toEqual({ entrance: "yes" });
	});

	it("stops with Mod+Z when no corner is left, the step before kept", () => {
		const { history, finished, options } = setup();
		history.setTags("n1", { entrance: "yes" });
		const mode = drawWayMode("area", options);
		mode.click?.(at(5, 5));
		mode.key?.(undoKey());
		expect(finished).toEqual([]);
		mode.key?.(undoKey());
		expect(finished).toEqual([null]);
		expect(history.previewing).toBe(false);
		expect(history.graph.entity("n1")?.tags).toEqual({ entrance: "yes" });
	});

	it("takes redo without doing anything while drawing", () => {
		const { history, options } = setup();
		history.setTags("n1", { entrance: "yes" });
		history.undo();
		const mode = drawWayMode("line", options);
		mode.click?.(at(5, 5));
		expect(mode.key?.(undoKey(true))).toBe(true);
		expect(history.graph.entity("n1")?.tags).toEqual({});
	});

	it("finishes as Escape does when told to (the shown level changed)", () => {
		const { history, finished, options } = setup();
		const mode = drawWayMode("line", options);
		mode.click?.(at(5, 5));
		mode.click?.(at(6, 5));
		mode.hover?.(at(7, 7));
		mode.finish?.();
		const way = history.graph.entity(finished[0] ?? "w0");
		expect(way?.type === "way" && way.nodes).toHaveLength(2);
		expect(history.previewing).toBe(false);
	});

	it("keeps nothing when left for another mode", () => {
		const { history, options } = setup();
		const mode = drawWayMode("line", options);
		mode.click?.(at(5, 5));
		mode.click?.(at(6, 5));
		mode.exit?.();
		expect(history.graph.hasChanges()).toBe(false);
	});
});

describe("drawWayMode with typed values (C.2)", () => {
	/** Metres east and north of [0, 0] (flat there). */
	const metres = (loc: readonly number[] | undefined) =>
		local([0, 0], loc ?? [0, 0]).map((v) => Math.round(v * 100) / 100);
	const typing = () => {
		const { history, finished, options } = setup();
		const shown: (Feedback | null)[] = [];
		const mode = drawWayMode("line", {
			...options,
			precision: {
				frameAt: (loc) => ({ origin: loc, angle: 0 }),
				step: () => null,
				units: () => "metric",
				show: (f) => shown.push(f),
			},
		});
		const type = (...keys: string[]) => {
			for (const k of keys) expect(mode.key?.(key(k))).toBe(true);
		};
		return { history, finished, mode, shown, type };
	};
	const corner = (
		history: EditHistory,
		id: EntityId | null | undefined,
		i: number,
	) => {
		const w = history.graph.entity(id ?? "w0");
		const n =
			w?.type === "way" ? history.graph.entity(w.nodes[i] ?? "n0") : undefined;
		return n?.type === "node" ? n.loc : undefined;
	};

	it("places the next corner a typed length along where the pointer points", () => {
		const { history, finished, mode, shown, type } = typing();
		mode.click?.(at(0, 0));
		mode.hover?.(at(0, 0.001));
		type("3", ".", "5", "Enter");
		expect(shown.at(-1)?.input).toBeUndefined();
		mode.key?.(key("Enter"));
		expect(metres(corner(history, finished[0], 1))).toEqual([0, 3.5]);
	});

	it("shows what is typed, and a corner there before Enter", () => {
		const { mode, shown, type } = typing();
		mode.click?.(at(0, 0));
		mode.hover?.(at(0.001, 0));
		type("2");
		expect(shown.at(-1)?.input).toEqual({
			length: "2",
			angle: "",
			field: "length",
		});
		expect(shown.at(-1)?.measures[0]?.length).toBeCloseTo(2, 2);
	});

	it("takes an angle after Tab, to the previous side", () => {
		const { history, finished, mode, type } = typing();
		mode.click?.(at(0, 0));
		mode.hover?.(at(0.001, 0));
		type("4", "Enter");
		// Pointing back up-left: 90° to the first side, on the pointer's side.
		mode.hover?.(at(0, 0.001));
		type("2", "Tab", "9", "0", "Enter");
		mode.key?.(key("Enter"));
		expect(metres(corner(history, finished[0], 2))).toEqual([4, 2]);
	});

	it("takes @dx,dy as an offset in the frame", () => {
		const { history, finished, mode, type } = typing();
		mode.click?.(at(0, 0));
		mode.hover?.(at(0.001, 0));
		type("@", "1", ",", "-", "2", "Enter");
		mode.key?.(key("Enter"));
		expect(metres(corner(history, finished[0], 1))).toEqual([1, -2]);
	});

	it("Escape clears what was typed before it stops the drawing", () => {
		const { finished, mode, type } = typing();
		mode.click?.(at(0, 0));
		type("2");
		mode.key?.(key("Escape"));
		expect(finished).toEqual([]);
		mode.key?.(key("Escape"));
		expect(finished).toEqual([null]);
	});

	it("leaves digits to the tool shortcuts before the first corner", () => {
		const { mode } = typing();
		expect(mode.key?.(key("2"))).toBe(false);
	});
});

describe("drawWayMode with inferences (C.4)", () => {
	const inferring = (snap: DrawSnap) => {
		let now = 0;
		const inferences = new Inferences(() => now);
		const { history, finished, options } = setup();
		const mode = drawWayMode("line", {
			...options,
			snap,
			precision: {
				frameAt: (loc) => ({ origin: loc, angle: 0 }),
				step: () => null,
				units: () => "metric",
				show: () => {},
				inferences,
			},
		});
		return {
			history,
			finished,
			mode,
			wait: (ms: number) => {
				now += ms;
			},
		};
	};

	it("a corner hovered for a moment gives lines in line with it, before the first click too", () => {
		const seen: (SnapConstraints | undefined)[] = [];
		const n2: SnapTarget = { kind: "node", id: "n2", loc: [2, 0] };
		const { mode, wait } = inferring((p, _exclude, _keep, constraints) => {
			seen.push(constraints);
			return p.lngLat[0] === 2 && p.lngLat[1] === 0 ? n2 : null;
		});
		mode.hover?.(at(2, 0));
		wait(500);
		mode.hover?.(at(2, 0));
		mode.hover?.(at(2, 5));
		const lines = seen.at(-1)?.lines ?? [];
		expect(lines.length).toBeGreaterThan(0);
		expect(
			lines.every((l) => l.kind === "tracking" && l.origin === n2.loc),
		).toBe(true);
	});

	it("a typed length on a tracking line is measured from the tracked corner", () => {
		const tracked = fromLocal([0, 0], [10, 0]);
		const onLine = fromLocal([0, 0], [10, 7]);
		const { history, finished, mode } = inferring((p) =>
			p.lngLat[0] === 0.5
				? {
						kind: "angle",
						loc: onLine,
						guides: [{ from: tracked, to: onLine, kind: "tracking" }],
					}
				: null,
		);
		mode.click?.(at(0, 0));
		mode.hover?.(at(0.5, 0.5));
		for (const k of ["4", "Enter", "Enter"]) mode.key?.(key(k));
		const w = history.graph.entity(finished[0] ?? "w0");
		const n =
			w?.type === "way" ? history.graph.entity(w.nodes[1] ?? "n0") : null;
		const placed = n?.type === "node" ? local([0, 0], n.loc) : [];
		expect(placed.map((v) => Math.round(v * 100) / 100)).toEqual([10, 4]);
	});
});

describe("drawPointMode", () => {
	it("places a door on a room's side", () => {
		const { history, finished, options } = setup(() => ({
			kind: "segment",
			segment: {
				way: "w1",
				a: { id: "n1", loc: [0, 0] },
				b: { id: "n2", loc: [2, 0] },
			},
			loc: [1, 0],
		}));
		drawPointMode(options).click?.(at(1, 0.01));
		const door = history.graph.entity(finished[0] ?? "n0");
		expect(door?.tags).toEqual({ indoor: "door", door: "yes" });
		expect(history.canUndo).toBe(true);
	});

	it("selects a tagged node instead of stacking a point on it", () => {
		const history = new EditHistory(
			graph().replace(node("n9", { amenity: "toilets" }, [9, 9])),
		);
		const finished: (EntityId | null)[] = [];
		drawPointMode({
			history,
			level: 0,
			snap: () => ({ kind: "node", id: "n9", loc: [9, 9] }),
			onfinish: (id) => finished.push(id),
		}).click?.(at(9, 9));
		expect(finished).toEqual(["n9"]);
		expect(history.canUndo).toBe(false);
	});

	it("places a point on the shown level elsewhere", () => {
		const { history, finished, options } = setup();
		drawPointMode(options).click?.(at(1, 1));
		expect(history.graph.entity(finished[0] ?? "n0")).toMatchObject({
			loc: [1, 1],
			tags: { level: "1" },
		});
	});
});
