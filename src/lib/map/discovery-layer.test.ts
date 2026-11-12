import {
	type StyleSpecification,
	validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { DISCOVERY_SOURCE, discoveryLayers } from "./discovery-layer.ts";

describe("discoveryLayers", () => {
	it("is a valid style for a clustered source", () => {
		const style: StyleSpecification = {
			version: 8,
			glyphs: "https://example.org/fonts/{fontstack}/{range}.pbf",
			sources: {
				[DISCOVERY_SOURCE]: {
					type: "geojson",
					data: { type: "FeatureCollection", features: [] },
					cluster: true,
				},
			},
			layers: discoveryLayers(16),
		};
		expect(validateStyleMin(style)).toEqual([]);
	});

	it("stops at the zoom where the data itself shows", () => {
		expect(discoveryLayers(16).map((l) => l.maxzoom)).toEqual([16, 16]);
	});
});
