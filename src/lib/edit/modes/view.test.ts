import { describe, expect, it } from "vitest";
import type { MapPoint } from "../mode.ts";
import { viewMode } from "./view.ts";

const at = (x: number): MapPoint => ({
	point: { x, y: 0 },
	lngLat: [0, 0],
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
});

/** A bubble left of x = 10, a room right of it. */
function setup() {
	const selected: (string | null)[] = [];
	const opened: string[] = [];
	const mode = viewMode({
		bubbleAt: (p) => (p.x < 10 ? "bubble" : null),
		openBubble: (b) => opened.push(b),
		hitTest: (p) => (p.x >= 10 ? "w1" : null),
		select: (id) => selected.push(id),
		hover: () => {},
	});
	return { mode, selected, opened };
}

describe("viewMode", () => {
	it("opens a bubble instead of selecting", () => {
		const { mode, selected, opened } = setup();
		mode.click?.(at(5));
		expect(opened).toEqual(["bubble"]);
		expect(selected).toEqual([]);
		expect(mode.hover?.(at(5))).toBe("pointer");
	});

	it("selects features elsewhere, and Escape clears the selection", () => {
		const { mode, selected } = setup();
		mode.click?.(at(20));
		mode.key?.({ key: "Escape" } as KeyboardEvent);
		expect(selected).toEqual(["w1", null]);
	});
});
