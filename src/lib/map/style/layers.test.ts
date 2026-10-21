import {
	featureFilter,
	type StyleSpecification,
	validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { INDOOR_SOURCE, indoorLayers } from "./layers.ts";

/** Geometry codes used by MapLibre's filter evaluation. */
const GEOMETRY = { Point: 1, LineString: 2, Polygon: 3 } as const;

function drawnBy(
	level: number,
	geometry: keyof typeof GEOMETRY,
	properties: Record<string, string>,
): string[] {
	return (
		indoorLayers(level)
			// Selection layers draw everything, invisible unless selected.
			.filter((layer) => !layer.id.startsWith("indoor-selection"))
			.filter((layer) => {
				if (!("filter" in layer) || !layer.filter) return true;
				return featureFilter(layer.filter, `layers.${layer.id}.filter`).filter(
					{ zoom: 19 },
					{ type: GEOMETRY[geometry], properties },
				);
			})
			.map((layer) => layer.id)
	);
}

describe("indoorLayers", () => {
	it("is a valid MapLibre style", () => {
		const style: StyleSpecification = {
			version: 8,
			glyphs: "https://example.org/fonts/{fontstack}/{range}.pbf",
			sources: {
				[INDOOR_SOURCE]: {
					type: "geojson",
					data: { type: "FeatureCollection", features: [] },
				},
			},
			layers: indoorLayers(0),
		};
		expect(validateStyleMin(style)).toEqual([]);
	});

	it("fills and outlines rooms, and labels them when they have a name or ref", () => {
		const room = { "@kind": "room", "@lv": ";0;" };
		expect(drawnBy(0, "Polygon", room)).toEqual([
			"indoor-fill",
			"indoor-outline",
		]);
		expect(drawnBy(0, "Polygon", { ...room, "@label": "B12" })).toEqual([
			"indoor-fill",
			"indoor-outline",
			"indoor-labels",
		]);
	});

	it("draws walls as lines", () => {
		expect(drawnBy(0, "LineString", { "@kind": "wall", "@lv": ";0;" })).toEqual(
			["indoor-lines"],
		);
	});

	it("draws doors as dots and points of interest as icons", () => {
		expect(drawnBy(0, "Point", { "@kind": "door", "@lv": ";0;" })).toEqual([
			"indoor-doors",
		]);
		expect(
			drawnBy(0, "Point", {
				"@kind": "poi",
				"@lv": ";0;",
				"@icon": "amenity_toilets",
			}),
		).toEqual(["indoor-labels"]);
	});

	it("draws points with neither icon nor name as dots", () => {
		expect(drawnBy(0, "Point", { "@kind": "poi", "@lv": ";0;" })).toEqual([
			"indoor-points",
		]);
		expect(
			drawnBy(0, "Point", { "@kind": "poi", "@lv": ";0;", "@label": "Desk" }),
		).toEqual(["indoor-labels"]);
	});

	it("draws nothing that is on another level", () => {
		expect(
			drawnBy(1, "Polygon", { "@kind": "room", "@lv": ";0;", "@label": "B12" }),
		).toEqual([]);
		expect(drawnBy(1, "Point", { "@kind": "door", "@lv": ";0;" })).toEqual([]);
	});

	it("draws features without level information on every level", () => {
		expect(drawnBy(3, "Polygon", { "@kind": "building", "@lv": "*" })).toEqual([
			"indoor-fill",
			"indoor-outline",
		]);
	});
});
