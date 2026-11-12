import { describe, expect, test } from "vitest";
import type { Loc } from "#lib/osm/entity.ts";
import { fromLocal } from "#lib/osm/geometry.ts";
import {
	bearingOf,
	fromFrame,
	lengthOf,
	normalizeAngle,
	outlineFrame,
	toFrame,
} from "./frame.ts";

const ORIGIN: Loc = [11.575, 48.137];

/** The position `east`, `north` metres from ORIGIN. */
const at = (east: number, north: number) => fromLocal(ORIGIN, [east, north]);

/** A closed rectangle `w` × `h` m from ORIGIN, its first side `degrees` from east. */
function rectangle(w: number, h: number, degrees: number): Loc[] {
	const r = (degrees * Math.PI) / 180;
	const ux = [Math.cos(r), Math.sin(r)];
	const uy = [-Math.sin(r), Math.cos(r)];
	const corner = (a: number, b: number) =>
		at(a * ux[0]! + b * uy[0]!, a * ux[1]! + b * uy[1]!);
	return [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h), corner(0, 0)];
}

describe("toFrame and fromFrame", () => {
	test("a frame turned 90° puts north on its x axis", () => {
		const frame = { origin: ORIGIN, angle: 90 };
		const [x, y] = toFrame(frame, at(0, 5));
		expect(x).toBeCloseTo(5, 6);
		expect(y).toBeCloseTo(0, 6);
		// And east on its −y axis.
		const [ex, ey] = toFrame(frame, at(3, 0));
		expect(ex).toBeCloseTo(0, 6);
		expect(ey).toBeCloseTo(-3, 6);
	});

	test("goes back to the same position", () => {
		const frame = { origin: ORIGIN, angle: 23 };
		const loc = fromFrame(frame, [12.5, -4]);
		const [x, y] = toFrame(frame, loc);
		expect(x).toBeCloseTo(12.5, 6);
		expect(y).toBeCloseTo(-4, 6);
	});
});

describe("lengths and bearings", () => {
	test("3-4-5", () => {
		expect(lengthOf(ORIGIN, at(3, 4))).toBeCloseTo(5, 6);
	});

	test("north-east is 45°, west is −180°", () => {
		expect(bearingOf(ORIGIN, at(1, 1))).toBeCloseTo(45, 6);
		expect(normalizeAngle(bearingOf(ORIGIN, at(-1, 0)))).toBeCloseTo(-180, 6);
	});

	test("normalizeAngle", () => {
		expect(normalizeAngle(190)).toBe(-170);
		expect(normalizeAngle(-190)).toBe(170);
		expect(normalizeAngle(360)).toBe(0);
	});
});

describe("outlineFrame", () => {
	test("an outline along east and north has a frame at 0°, from its south-west corner", () => {
		const frame = outlineFrame(rectangle(10, 6, 0));
		expect(frame?.angle).toBe(0);
		expect(lengthOf(frame?.origin ?? [0, 0], ORIGIN)).toBeLessThan(0.01);
	});

	test("a building turned 30° has a frame at 30°", () => {
		const frame = outlineFrame(rectangle(10, 6, 30));
		expect(frame?.angle).toBeCloseTo(30, 4);
		expect(lengthOf(frame?.origin ?? [0, 0], ORIGIN)).toBeLessThan(0.01);
	});

	test("a building turned 60° has a frame at −30° (the same axes)", () => {
		const frame = outlineFrame(rectangle(10, 6, 60));
		expect(frame?.angle).toBeCloseTo(-30, 4);
		// The corner that is south-west in the frame: (0, 6) of the rectangle, 6 m at 150°.
		const corner = at(
			6 * Math.cos((150 * Math.PI) / 180),
			6 * Math.sin((150 * Math.PI) / 180),
		);
		expect(lengthOf(frame?.origin ?? [0, 0], corner)).toBeLessThan(0.01);
	});

	test("long sides weigh more than a short cut corner", () => {
		// A 20 × 10 m box with its north-east corner cut by a 1.41 m side at 45°.
		const ring = [
			at(0, 0),
			at(20, 0),
			at(20, 9),
			at(19, 10),
			at(0, 10),
			at(0, 0),
		];
		expect(Math.abs(outlineFrame(ring)?.angle ?? 99)).toBeLessThan(1);
	});

	test("no frame without a side", () => {
		expect(outlineFrame([ORIGIN, ORIGIN])).toBeNull();
		expect(outlineFrame([])).toBeNull();
	});
});
