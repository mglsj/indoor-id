import { describe, expect, test } from "vitest";
import { msg } from "#lib/i18n/messages.ts";
import type { Loc } from "#lib/osm/entity.ts";
import { fromLocal } from "#lib/osm/geometry.ts";
import { inferenceLabel, sideMeasure } from "./feedback.ts";

const O: Loc = [11.575, 48.137];
const at = (east: number, north: number) => fromLocal(O, [east, north]);
const frame = { origin: O, angle: 0 };

describe("sideMeasure", () => {
	test("a first side north is 3 m at 90° in a north frame", () => {
		const m = sideMeasure(O, at(0, 3), frame);
		expect(m.length).toBeCloseTo(3, 6);
		expect(m.angle).toBeCloseTo(90, 6);
		expect(m.pointer).toBe(true);
	});

	test("a first side south is at 270°, and at 240° in a frame turned 30°", () => {
		expect(sideMeasure(O, at(0, -2), frame).angle).toBeCloseTo(270, 6);
		expect(
			sideMeasure(O, at(0, -2), { origin: O, angle: 30 }).angle,
		).toBeCloseTo(240, 6);
	});

	test("after a side, the angle at the corner: square is 90°, straight on is 180°", () => {
		const previous = at(-4, 0);
		expect(sideMeasure(O, at(0, 2), frame, previous).angle).toBeCloseTo(90, 6);
		expect(sideMeasure(O, at(0, -2), frame, previous).angle).toBeCloseTo(90, 6);
		expect(sideMeasure(O, at(5, 0), frame, previous).angle).toBeCloseTo(180, 6);
		expect(sideMeasure(O, at(-1, 1), frame, previous).angle).toBeCloseTo(45, 6);
	});
});

describe("inferenceLabel", () => {
	const side = {
		way: "w1" as const,
		a: { id: "n1" as const, loc: O },
		b: { id: "n2" as const, loc: at(4, 0) },
	};

	test("names the inference a snap came from", () => {
		expect(
			inferenceLabel({
				kind: "intersection",
				loc: at(1, 1),
				guides: [
					{ from: O, to: at(1, 1) },
					{ from: at(1, 5), to: at(1, 1), kind: "tracking" },
				],
			}),
		).toEqual(msg("inference_tracking"));
		expect(
			inferenceLabel({
				kind: "segment",
				segment: side,
				loc: at(1, 0),
				mark: "perpendicular",
				guides: [{ from: at(1, 3), to: at(1, 0), kind: "perpendicular" }],
			}),
		).toEqual(msg("inference_perpendicular"));
	});

	test("names midpoints and crossings, nothing for a plain angle or node", () => {
		expect(
			inferenceLabel({
				kind: "segment",
				segment: side,
				loc: at(2, 0),
				mark: "midpoint",
			}),
		).toEqual(msg("inference_midpoint"));
		expect(
			inferenceLabel({
				kind: "intersection",
				loc: at(1, 1),
				guides: [{ from: O, to: at(1, 1) }],
			}),
		).toEqual(msg("inference_intersection"));
		expect(
			inferenceLabel({
				kind: "angle",
				loc: at(1, 1),
				guides: [{ from: O, to: at(1, 1) }],
			}),
		).toBeUndefined();
		expect(inferenceLabel({ kind: "node", id: "n1", loc: O })).toBeUndefined();
	});
});
