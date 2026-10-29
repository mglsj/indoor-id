import { describe, expect, it } from "vitest";
import type { Loc } from "#lib/osm/entity.ts";
import type { MapPoint } from "../mode.ts";
import { splitMode } from "./split.ts";

const at = (x: number, y = 0): MapPoint => ({
	point: { x, y },
	lngLat: [x, y],
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
});

function setup(snap: (p: MapPoint) => Loc | null = () => null) {
	const changes: (readonly Loc[])[] = [];
	const finished: (readonly Loc[] | null)[] = [];
	const mode = splitMode({
		snap,
		onchange: (cut) => changes.push(cut),
		onfinish: (cut) => finished.push(cut),
	});
	return { mode, changes, finished };
}

const key = (k: string) => ({ key: k }) as KeyboardEvent;

describe("splitMode", () => {
	it("draws a cut click by click, the pointer dragging its last side", () => {
		const { mode, changes } = setup();
		mode.click?.(at(0));
		expect(mode.hover?.(at(50))).toBe("crosshair");
		expect(changes.at(-1)).toEqual([
			[0, 0],
			[50, 0],
		]);
	});

	it("finishes with a second click on the last point, or Enter", () => {
		const { mode, finished, changes } = setup();
		mode.click?.(at(0));
		mode.click?.(at(100));
		mode.click?.(at(103));
		expect(finished).toEqual([
			[
				[0, 0],
				[100, 0],
			],
		]);
		// The line drawn goes once finished.
		expect(changes.at(-1)).toEqual([]);

		const other = setup();
		other.mode.click?.(at(0));
		other.mode.click?.(at(100));
		expect(other.mode.key?.(key("Enter"))).toBe(true);
		expect(other.finished).toHaveLength(1);
	});

	it("snaps its points", () => {
		const { mode, finished } = setup((p) => (p.point.x > 90 ? [99, 9] : null));
		mode.click?.(at(0));
		mode.click?.(at(95));
		mode.key?.(key("Enter"));
		expect(finished[0]).toEqual([
			[0, 0],
			[99, 9],
		]);
	});

	it("takes the last point back with Backspace, and stops on Escape", () => {
		const { mode, finished, changes } = setup();
		mode.click?.(at(0));
		mode.click?.(at(100));
		mode.key?.(key("Backspace"));
		expect(changes.at(-1)).toEqual([[0, 0]]);
		mode.key?.(key("Escape"));
		mode.exit?.();
		expect(finished).toEqual([null]);
	});

	it("drops the line, without finishing, when another tool takes over", () => {
		const { mode, finished, changes } = setup();
		mode.click?.(at(0));
		mode.exit?.();
		expect(finished).toEqual([]);
		expect(changes.at(-1)).toEqual([]);
	});

	it("doesn't cut with fewer than two points", () => {
		const { mode, finished } = setup();
		mode.click?.(at(0));
		mode.key?.(key("Enter"));
		expect(finished).toEqual([null]);
	});
});
