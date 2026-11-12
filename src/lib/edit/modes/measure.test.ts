import { describe, expect, it } from "vitest";
import type { Feedback } from "#lib/edit/precision/feedback.ts";
import type { DirectionLine, SnapTarget } from "#lib/edit/precision/snap.ts";
import type { Loc } from "#lib/osm/entity.ts";
import { fromLocal, local } from "#lib/osm/geometry.ts";
import type { MapPoint } from "../mode.ts";
import type { DrawSnap } from "./draw.ts";
import { type MeasureVariant, measureMode } from "./measure.ts";

const O: Loc = [11.575, 48.137];
/** A pointer `east` and `north` metres from O. */
const at = (east: number, north: number): MapPoint => ({
	point: { x: east, y: -north },
	lngLat: fromLocal(O, [east, north]),
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
});
const key = (k: string) =>
	({ key: k, ctrlKey: false, metaKey: false, altKey: false }) as KeyboardEvent;
const metres = (loc: Loc) =>
	local(O, loc).map((v) => Math.round(v * 1000) / 1000);

/** A side from (0, 0) to (10, 0), snapped to within 0.5 m of it. */
const side = {
	way: "w1" as const,
	a: { id: "n1" as const, loc: fromLocal(O, [0, 0]) },
	b: { id: "n2" as const, loc: fromLocal(O, [10, 0]) },
};
const snapToSide: DrawSnap = (p) => {
	const [x, y] = local(O, p.lngLat);
	return Math.abs(y) < 0.5 && x > 0 && x < 10
		? ({
				kind: "segment",
				segment: side,
				loc: fromLocal(O, [x, 0]),
			} as SnapTarget)
		: null;
};

function setup(
	variant: MeasureVariant = "measure",
	snap: DrawSnap = () => null,
) {
	const shown: (Feedback | null)[] = [];
	const guides: DirectionLine[] = [];
	const variants: MeasureVariant[] = [];
	let exited = false;
	const mode = measureMode({
		snap,
		variant,
		precision: {
			frameAt: (loc) => ({ origin: loc, angle: 0 }),
			step: () => null,
			units: () => "metric",
			show: (f) => shown.push(f),
		},
		onvariant: (v) => variants.push(v),
		onguide: (g) => guides.push(g),
		onexit: () => {
			exited = true;
		},
	});
	return { mode, shown, guides, variants, exited: () => exited };
}

describe("measureMode: measuring", () => {
	it("two clicks give the distance and angle, kept until the next measure", () => {
		const { mode, shown } = setup();
		mode.click?.(at(0, 0));
		mode.hover?.(at(3, 4));
		expect(shown.at(-1)?.measures[0]).toMatchObject({ pointer: true });
		expect(shown.at(-1)?.measures[0]?.length).toBeCloseTo(5, 3);
		mode.click?.(at(3, 4));
		mode.hover?.(at(20, 20));
		const kept = shown.at(-1)?.measures[0];
		expect(kept?.pointer).toBe(false);
		expect(kept?.length).toBeCloseTo(5, 3);
		expect(kept?.angle).toBeCloseTo(53.13, 2);
		expect(shown.at(-1)?.lines).toHaveLength(1);
		// The next click starts over.
		mode.click?.(at(20, 20));
		expect(shown.at(-1)?.measures).toEqual([]);
	});

	it("Escape takes back the first click, then the measure, then leaves", () => {
		const { mode, exited } = setup();
		mode.click?.(at(0, 0));
		mode.click?.(at(1, 0));
		expect(mode.key?.(key("Escape"))).toBe(true);
		expect(exited()).toBe(false);
		mode.key?.(key("Escape"));
		expect(exited()).toBe(true);
	});

	it("Tab switches to placing guides", () => {
		const { mode, variants } = setup();
		expect(mode.key?.(key("Tab"))).toBe(true);
		expect(variants).toEqual(["guide"]);
	});
});

describe("measureMode: guides", () => {
	it("a click on a side, then a typed distance: a parallel guide on the pointer's side", () => {
		const { mode, guides } = setup("guide", snapToSide);
		mode.click?.(at(5, 0.2));
		mode.hover?.(at(4, 6));
		for (const k of ["2", ".", "4", "Enter"])
			expect(mode.key?.(key(k))).toBe(true);
		expect(guides).toHaveLength(1);
		expect(metres(guides[0]?.origin ?? O)).toEqual([0, 2.4]);
		expect(guides[0]?.angle).toBeCloseTo(0, 6);
	});

	it("a click on a side, then a click: a parallel guide through the second point", () => {
		const { mode, guides } = setup("guide", snapToSide);
		mode.click?.(at(5, 0.2));
		mode.click?.(at(7, -3));
		expect(metres(guides[0]?.origin ?? O)).toEqual([0, -3]);
	});

	it("a click on a point, then a second point: the guide through both", () => {
		const { mode, guides } = setup("guide");
		mode.click?.(at(1, 1));
		mode.click?.(at(4, 4));
		expect(metres(guides[0]?.origin ?? O)).toEqual([1, 1]);
		expect(guides[0]?.angle).toBeCloseTo(45, 4);
	});

	it("a click on a point, then a typed angle against the frame", () => {
		const { mode, guides } = setup("guide");
		mode.click?.(at(1, 1));
		mode.hover?.(at(5, 1));
		for (const k of ["3", "0", "Enter"]) mode.key?.(key(k));
		expect(guides[0]?.angle).toBe(30);
		expect(metres(guides[0]?.origin ?? O)).toEqual([1, 1]);
	});

	it("leaves digits to the shortcuts before the first click", () => {
		const { mode } = setup("guide");
		expect(mode.key?.(key("2"))).toBe(false);
	});
});
