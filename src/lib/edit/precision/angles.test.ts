import { describe, expect, test } from "vitest";
import type { Loc } from "#lib/osm/entity.ts";
import { fromLocal } from "#lib/osm/geometry.ts";
import { angleLines } from "./angles.ts";

const O: Loc = [11.575, 48.137];
const at = (east: number, north: number) => fromLocal(O, [east, north]);
const angles = (lines: { angle: number }[]) =>
	lines.map((l) => Math.round(l.angle * 1000) / 1000).sort((a, b) => a - b);

describe("angleLines", () => {
	test("every 15° from the frame's axes: 12 lines", () => {
		const lines = angleLines({
			from: O,
			frame: { origin: O, angle: 0 },
			step: 15,
		});
		expect(angles(lines)).toEqual([
			0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165,
		]);
		expect(lines.every((l) => l.origin === O)).toBe(true);
	});

	test("90° is Ortho in a frame turned 30°", () => {
		const lines = angleLines({
			from: O,
			frame: { origin: O, angle: 30 },
			step: 90,
		});
		expect(angles(lines)).toEqual([30, 120]);
	});

	test("from the previous side too, without repeating a direction", () => {
		// The previous side came from the south-west, at 45°.
		const lines = angleLines({
			from: O,
			previous: at(-1, -1),
			frame: { origin: O, angle: 0 },
			step: 90,
		});
		expect(angles(lines)).toEqual([0, 45, 90, 135]);
	});

	test("along the first side and square to it, from the first corner", () => {
		const a = at(-10, 0);
		const b = at(-10, 5);
		const lines = angleLines({
			from: O,
			firstSide: [a, b],
			frame: { origin: O, angle: 0 },
			step: 90,
		});
		const fromFirst = lines.filter((l) => l.origin === a);
		expect(angles(fromFirst)).toEqual([0, 90]);
	});
});
