import { describe, expect, it } from "vitest";
import { guideFeatures } from "./guide-layer.ts";

describe("guideFeatures", () => {
	it("draws nothing without feedback or a snap", () => {
		expect(guideFeatures(null).features).toEqual([]);
		expect(guideFeatures({ snap: null, measures: [] }).features).toEqual([]);
	});

	it("draws an angle snap's ray and a mark", () => {
		const { features } = guideFeatures({
			snap: {
				kind: "angle",
				loc: [1, 0],
				guides: [{ from: [0, 0], to: [1, 0] }],
			},
			measures: [],
		});
		expect(features.map((f) => f.properties)).toEqual([
			{ role: "guide" },
			{ role: "mark", mark: "angle" },
		]);
		expect(features[0]?.geometry).toEqual({
			type: "LineString",
			coordinates: [
				[0, 0],
				[1, 0],
			],
		});
	});

	it("marks a midpoint as such", () => {
		const side = {
			way: "w1" as const,
			a: { id: "n1" as const, loc: [0, 0] as [number, number] },
			b: { id: "n2" as const, loc: [2, 0] as [number, number] },
		};
		const { features } = guideFeatures({
			snap: { kind: "segment", segment: side, loc: [1, 0], mark: "midpoint" },
			measures: [],
		});
		expect(features.map((f) => f.properties)).toEqual([
			{ role: "mark", mark: "midpoint" },
		]);
	});

	it("marks the corners armed for tracking", () => {
		const { features } = guideFeatures({
			snap: null,
			measures: [],
			armed: [[2, 3]],
		});
		expect(features).toEqual([
			{
				type: "Feature",
				properties: { role: "mark", mark: "armed" },
				geometry: { type: "Point", coordinates: [2, 3] },
			},
		]);
	});
});
