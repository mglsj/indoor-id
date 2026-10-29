import { describe, expect, it } from "vitest";
import type { MapPoint } from "../mode.ts";
import { browseMode } from "./browse.ts";

const at = (x: number): MapPoint => ({
	point: { x, y: 0 },
	lngLat: [0, 0],
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
});

/** A room drawn right of x = 50. */
function setup() {
	const log: { selected: (string | null)[]; hovered: (string | null)[] } = {
		selected: [],
		hovered: [],
	};
	const mode = browseMode({
		hitTest: (point) => (point.x > 50 ? "w1" : null),
		select: (id) => log.selected.push(id),
		hover: (id) => log.hovered.push(id),
	});
	return { mode, log };
}

describe("browseMode", () => {
	it("hovers the feature under the pointer, with a pointer cursor", () => {
		const { mode, log } = setup();
		expect(mode.hover?.(at(60))).toBe("pointer");
		expect(mode.hover?.(at(10))).toBe("");
		expect(log.hovered).toEqual(["w1", null]);
	});

	it("hovers nothing once the pointer leaves the map or the mode ends", () => {
		const { mode, log } = setup();
		mode.hover?.(at(60));
		mode.leave?.();
		mode.hover?.(at(60));
		mode.exit?.();
		expect(log.hovered).toEqual(["w1", null, "w1", null]);
	});

	it("selects what is clicked, and nothing on Escape", () => {
		const { mode, log } = setup();
		mode.click?.(at(60));
		mode.click?.(at(10));
		expect(mode.key?.({ key: "Escape" } as KeyboardEvent)).toBe(true);
		expect(log.selected).toEqual(["w1", null, null]);
	});
});

describe("browseMode with Shift+click", () => {
	it("adds what is clicked to the selection, or takes it out, and keeps it on the empty map", () => {
		const toggled: string[] = [];
		const selected: (string | null)[] = [];
		const mode = browseMode({
			hitTest: (point) => (point.x > 50 ? "w1" : null),
			select: (id) => selected.push(id),
			hover: () => {},
			toggle: (id) => toggled.push(id),
		});
		mode.click?.({ ...at(60), shiftKey: true });
		mode.click?.({ ...at(10), shiftKey: true });
		expect(toggled).toEqual(["w1"]);
		expect(selected).toEqual([]);
		// MapLibre's Shift+drag zoom is off: it would take the click.
		expect(mode.gestures).toEqual({ boxZoom: false });
	});

	it("starts a lasso on Shift+press where nothing is dragged", () => {
		const lassoed: MapPoint[] = [];
		const lasso = {
			cursor: "crosshair",
			move: () => {},
			end: () => {},
			cancel: () => {},
		};
		const mode = browseMode({
			hitTest: () => null,
			select: () => {},
			hover: () => {},
			lasso: (p) => {
				lassoed.push(p);
				return lasso;
			},
		});
		expect(mode.press?.(at(10))).toBeNull();
		expect(mode.press?.({ ...at(10), shiftKey: true })).toMatchObject({
			cursor: "crosshair",
		});
		expect(lassoed).toHaveLength(1);
	});

	it("takes a Shift+press released without moving as a Shift+click", () => {
		const toggled: string[] = [];
		const mode = browseMode({
			hitTest: () => "w1",
			select: () => {},
			hover: () => {},
			toggle: (id) => toggled.push(id),
			lasso: () => ({ move: () => {}, end: () => {}, cancel: () => {} }),
		});
		mode.press?.({ ...at(10), shiftKey: true })?.cancel();
		expect(toggled).toEqual(["w1"]);
	});

	it("tells where the pointer is, and when it left", () => {
		const pointers: (MapPoint | null)[] = [];
		const mode = browseMode({
			hitTest: () => null,
			select: () => {},
			hover: () => {},
			pointer: (p) => pointers.push(p),
		});
		mode.hover?.(at(10));
		mode.leave?.();
		expect(pointers).toEqual([at(10), null]);
	});
});

describe("browseMode with the edit overlay", () => {
	/** A vertex n1 at x = 60, inside the room. */
	function overlay() {
		const log: { selected: (string | null)[]; hovered: (string | null)[] } = {
			selected: [],
			hovered: [],
		};
		const near = (point: { x: number }) => Math.abs(point.x - 60) < 5;
		const drag = { move() {}, end() {}, cancel() {} };
		const mode = browseMode({
			hitTest: (point) => (point.x > 50 ? "w1" : null),
			select: (id) => log.selected.push(id),
			hover: (id) => log.hovered.push(id),
			draggable: near,
			vertexAt: (point) => (near(point) ? "n1" : null),
			drag: (at) => (near(at.point) ? drag : null),
		});
		return { mode, log, drag };
	}

	it("shows a vertex can be dragged, keeping its way hovered", () => {
		const { mode, log } = overlay();
		expect(mode.hover?.(at(70))).toBe("pointer");
		expect(mode.hover?.(at(60))).toBe("move");
		expect(log.hovered).toEqual(["w1"]);
	});

	it("selects a clicked vertex rather than its way", () => {
		const { mode, log } = overlay();
		mode.click?.(at(60));
		mode.click?.(at(70));
		expect(log.selected).toEqual(["n1", "w1"]);
	});

	it("drags what is pressed, and lets the map pan elsewhere", () => {
		const { mode, drag } = overlay();
		expect(mode.press?.(at(60))).toBe(drag);
		expect(mode.press?.(at(70))).toBeNull();
	});
});
