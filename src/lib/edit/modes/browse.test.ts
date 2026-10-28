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
