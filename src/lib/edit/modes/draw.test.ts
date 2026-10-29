import { describe, expect, it } from "vitest";
import type { SnapTarget } from "#lib/map/snap.ts";
import type { EntityId } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { EditHistory } from "#lib/state/edit-history.svelte.ts";
import type { MapPoint } from "../mode.ts";
import { drawPointMode, drawWayMode } from "./draw.ts";

const at = (lon: number, lat: number): MapPoint => ({
	point: { x: lon, y: lat },
	lngLat: [lon, lat],
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
});
const key = (k: string) => ({ key: k }) as KeyboardEvent;
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
