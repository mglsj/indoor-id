import type { LineString } from "geojson";
import { describe, expect, it } from "vitest";
import { place } from "#lib/floorplans/georef.ts";
import {
	distance,
	northUpPlan,
	offset,
	RENNES,
} from "#lib/floorplans/test-geometry.ts";
import type { FloorPlan, Tool } from "#lib/state/floorplans.svelte.ts";
import { planFrames, stackLayerIds, toolFeatures } from "./floorplan-layers.ts";

/** A 400 × 300 px plan, north up at 5 cm per pixel, its top-left pixel at RENNES. */
const truth = northUpPlan(RENNES);
const plan: FloorPlan = {
	id: "p",
	name: "plan",
	size: { width: 400, height: 300 },
	source: { kind: "raster", file: "p" },
	transform: place(
		{ center: truth(200, 150), metresPerPixel: 0.05, bearing: 0 },
		400,
		300,
	),
	controlPoints: [],
	fitKind: "similarity",
	opacity: 0.5,
	level: "0",
	visible: true,
	color: "#2563eb",
	hiddenLayers: [],
};

function linesOf(tool: Tool, pointer?: [number, number]) {
	return toolFeatures(plan, tool, false, pointer)
		.features.filter((f) => f.geometry.type === "LineString")
		.map((f) => ({
			role: f.properties?.role,
			coordinates: (f.geometry as LineString).coordinates as [number, number][],
		}));
}

describe("toolFeatures, measuring", () => {
	it("draws a dashed line from the first measured spot to the pointer", () => {
		const pointer = offset(RENNES, 30, -5);
		const lines = linesOf({ kind: "measure", points: [[20, 40]] }, pointer);

		expect(lines).toHaveLength(1);
		expect(lines[0]?.role).toBe("rubber");
		const [from, to] = lines[0]?.coordinates ?? [];
		if (!from || !to) throw new Error("No line");
		// Pixel (20, 40) is 1 m east and 2 m south of the top-left corner.
		expect(distance(from, offset(RENNES, 1, -2))).toBeLessThan(0.001);
		expect(to).toEqual(pointer);
	});

	it("draws nothing to follow the pointer before the first spot, or without a pointer", () => {
		expect(
			linesOf({ kind: "measure", points: [] }, offset(RENNES, 1, -1)),
		).toEqual([]);
		expect(linesOf({ kind: "measure", points: [[20, 40]] })).toEqual([]);
	});

	it("joins the two measured spots with a solid line, whatever the pointer does", () => {
		const lines = linesOf(
			{
				kind: "measure",
				points: [
					[20, 40],
					[380, 40],
				],
			},
			offset(RENNES, 30, -5),
		);

		expect(lines).toHaveLength(1);
		expect(lines[0]?.role).toBe("measured");
		const [from, to] = lines[0]?.coordinates ?? [];
		if (!from || !to) throw new Error("No line");
		expect(distance(from, offset(RENNES, 1, -2))).toBeLessThan(0.001);
		// 360 px further east: 18 m.
		expect(distance(to, offset(RENNES, 19, -2))).toBeLessThan(0.001);
	});
});

describe("planFrames", () => {
	const other: FloorPlan = { ...plan, id: "q", level: "1", color: "#ea580c" };
	const everywhere: FloorPlan = {
		...plan,
		id: "r",
		level: null,
		color: "#16a34a",
	};
	const hidden: FloorPlan = { ...plan, id: "s", visible: false };

	function framesOn(level: number) {
		return planFrames([plan, other, everywhere, hidden], level).features.map(
			(f) => ({
				role: f.properties?.role,
				color: f.properties?.color,
				ring: (f.geometry as LineString).coordinates.length,
			}),
		);
	}

	it("frames every visible plan of the level shown, each in its colour", () => {
		expect(framesOn(0)).toEqual([
			{ role: "frame", color: "#2563eb", ring: 5 },
			{ role: "frame", color: "#16a34a", ring: 5 },
		]);
		expect(framesOn(1)).toEqual([
			{ role: "frame", color: "#ea580c", ring: 5 },
			{ role: "frame", color: "#16a34a", ring: 5 },
		]);
	});

	it("draws a frame around the plan's four corners", () => {
		const [frame] = planFrames([plan], 0).features;
		if (!frame) throw new Error("No frame");
		const ring = (frame.geometry as LineString).coordinates as [
			number,
			number,
		][];
		// 400 × 300 px at 5 cm: 20 m east, 15 m south of the top-left corner.
		const expected = [
			RENNES,
			offset(RENNES, 20, 0),
			offset(RENNES, 20, -15),
			offset(RENNES, 0, -15),
			RENNES,
		];
		ring.forEach((p, i) => {
			expect(distance(p, expected[i] ?? [0, 0])).toBeLessThan(0.001);
		});
	});
});

describe("toolFeatures, colours", () => {
	it("draws the plan's handles and marks in its colour", () => {
		const withPoint: FloorPlan = {
			...plan,
			controlPoints: [{ image: [20, 40], map: offset(RENNES, 2, -2) }],
		};
		const features = toolFeatures(withPoint, null, true).features;
		expect(features.length).toBeGreaterThan(0);
		for (const f of features) expect(f.properties?.color).toBe("#2563eb");
		// Frames come from planFrames, for every plan alike.
		expect(features.some((f) => f.properties?.role === "frame")).toBe(false);
	});
});

describe("stackLayerIds", () => {
	it("lists the map layers bottom to top: each plan's tiles, and the buildings in place", () => {
		const a = { ...plan, id: "a" };
		const b = { ...plan, id: "b" };
		const tiles: Record<string, string[]> = {
			a: ["floorplan-a-0", "floorplan-a-1"],
			b: ["floorplan-b-0"],
		};
		expect(
			stackLayerIds(
				[
					{ kind: "plan", plan: a },
					{ kind: "buildings" },
					{ kind: "plan", plan: b },
				],
				(id) => tiles[id] ?? [],
				"indoor-buildings",
			),
		).toEqual([
			"floorplan-a-0",
			"floorplan-a-1",
			"indoor-buildings",
			"floorplan-b-0",
		]);
	});

	it("skips plans not drawn", () => {
		expect(
			stackLayerIds(
				[{ kind: "buildings" }, { kind: "plan", plan }],
				() => [],
				"indoor-buildings",
			),
		).toEqual(["indoor-buildings"]);
	});
});
