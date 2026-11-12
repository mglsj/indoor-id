import {
	featureFilter,
	type StyleSpecification,
	validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import {
	BAND_SOURCE,
	INDOOR_SOURCE,
	indoorLayers,
	selectableLayers,
} from "./layers.ts";

/** Geometry codes used by MapLibre's filter evaluation. */
const GEOMETRY = { Point: 1, LineString: 2, Polygon: 3 } as const;

function drawnBy(
	level: number,
	geometry: keyof typeof GEOMETRY,
	properties: Record<string, string>,
): string[] {
	return (
		indoorLayers(level)
			// Selection and edit layers draw everything, invisible unless selected or edited.
			.filter(
				(layer) =>
					!layer.id.startsWith("indoor-selection") &&
					!layer.id.startsWith("indoor-edited"),
			)
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
				[BAND_SOURCE]: {
					type: "geojson",
					data: { type: "FeatureCollection", features: [] },
				},
			},
			layers: indoorLayers(0),
		};
		expect(validateStyleMin(style)).toEqual([]);
	});

	it("draws arrows along lines with a direction", () => {
		const steps = { "@kind": "path", "@lv": ";0;", highway: "steps" };
		expect(drawnBy(0, "LineString", steps)).toEqual(["indoor-lines"]);
		expect(drawnBy(0, "LineString", { ...steps, "@arrow": "forward" })).toEqual(
			["indoor-lines", "indoor-arrows"],
		);
	});

	it("fills and outlines rooms, and labels them when they have a name or ref", () => {
		const room = { "@kind": "room", "@lv": ";0;" };
		expect(drawnBy(0, "Polygon", room)).toEqual([
			"indoor-fill",
			"indoor-fill-band",
			"indoor-outline",
		]);
		expect(drawnBy(0, "Polygon", { ...room, "@label": "B12" })).toEqual([
			"indoor-fill",
			"indoor-fill-band",
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
			"indoor-fill-band",
			"indoor-outline",
		]);
	});
});

describe("indoorLayers: presentation and theme", () => {
	const paint = (layers: ReturnType<typeof indoorLayers>, id: string) =>
		layers.find((l) => l.id === id)?.paint as Record<string, unknown>;

	it("draws dark colours for a dark map", () => {
		const view = { presentation: "view" } as const;
		const light = JSON.stringify(paint(indoorLayers(0, view), "indoor-fill"));
		const dark = JSON.stringify(
			paint(indoorLayers(0, { ...view, theme: "dark" }), "indoor-fill"),
		);
		expect(light).toContain("#d6d1c7");
		expect(dark).not.toContain("#d6d1c7");
		expect(dark).toContain("#4a463f");
		expect(
			paint(indoorLayers(0, { theme: "dark" }), "indoor-labels")["text-color"],
		).toBe("#eeeeee");
	});

	it("draws rooms nearly opaque in the viewer", () => {
		expect(
			paint(indoorLayers(0, { presentation: "view" }), "indoor-fill")[
				"fill-opacity"
			],
		).toEqual(["match", ["get", "@kind"], "building", 0.85, 0.95]);
	});

	it("edits with iD's colours: its building red, white bands on a dark map", () => {
		const dark = JSON.stringify(
			paint(indoorLayers(0, { theme: "dark" }), "indoor-fill-band"),
		);
		expect(dark).toContain("rgba(224, 110, 95, 0.3)");
		expect(dark).toContain("rgba(255, 255, 255, 0.3)");
		// White bands would vanish on the light map: grey ones instead.
		const light = JSON.stringify(paint(indoorLayers(0), "indoor-fill-band"));
		expect(light).not.toContain("rgba(255, 255, 255, 0.3)");
	});

	it("fills areas with a band inside their outline unless asked otherwise (iD)", () => {
		const shown = (fill: "wireframe" | "partial" | "full") => {
			const layers = indoorLayers(0, { fill });
			return {
				band: paint(layers, "indoor-fill-band")["fill-opacity"],
				fill: paint(layers, "indoor-fill")["fill-opacity"],
			};
		};
		expect(shown("partial")).toEqual({ band: 1, fill: 0 });
		expect(shown("full")).toEqual({ band: 0, fill: 1 });
		expect(shown("wireframe")).toEqual({ band: 0, fill: 0 });
		expect(
			paint(indoorLayers(0, { fill: "wireframe" }), "indoor-outline")[
				"line-width"
			],
		).toBe(1);
		// The viewer fills areas whole whatever the editor's fill.
		expect(
			paint(
				indoorLayers(0, { presentation: "view", fill: "wireframe" }),
				"indoor-fill-band",
			)["fill-opacity"],
		).toBe(0);
	});

	it("draws the band from its own source of built shapes", () => {
		const band = indoorLayers(0).find((l) => l.id === "indoor-fill-band");
		expect(band).toMatchObject({ type: "fill", source: BAND_SOURCE });
	});

	it("picks areas by their band or outline unless they are filled whole", () => {
		expect(selectableLayers("partial")).toContain("indoor-fill-band");
		expect(selectableLayers("partial")).not.toContain("indoor-fill");
		expect(selectableLayers("wireframe")).not.toContain("indoor-fill-band");
		expect(selectableLayers("wireframe")).toContain("indoor-outline");
		expect(selectableLayers("full")).toContain("indoor-fill");
	});

	it("is a valid style in every presentation and theme", () => {
		for (const presentation of ["edit", "view"] as const) {
			for (const theme of ["light", "dark"] as const) {
				const style: StyleSpecification = {
					version: 8,
					glyphs: "https://example.org/fonts/{fontstack}/{range}.pbf",
					sources: {
						[INDOOR_SOURCE]: {
							type: "geojson",
							data: { type: "FeatureCollection", features: [] },
						},
						[BAND_SOURCE]: {
							type: "geojson",
							data: { type: "FeatureCollection", features: [] },
						},
					},
					layers: indoorLayers(0, { presentation, theme }),
				};
				expect(validateStyleMin(style)).toEqual([]);
			}
		}
		for (const fill of ["wireframe", "partial", "full"] as const) {
			const style: StyleSpecification = {
				version: 8,
				sources: {
					[INDOOR_SOURCE]: {
						type: "geojson",
						data: { type: "FeatureCollection", features: [] },
					},
					[BAND_SOURCE]: {
						type: "geojson",
						data: { type: "FeatureCollection", features: [] },
					},
				},
				glyphs: "https://example.org/fonts/{fontstack}/{range}.pbf",
				layers: indoorLayers(0, { fill }),
			};
			expect(validateStyleMin(style)).toEqual([]);
		}
	});
});

describe("indoorLayers: edits and labels", () => {
	const paint = (id: string) =>
		indoorLayers(0).find((l) => l.id === id)?.paint as Record<string, unknown>;

	it("draws iD's halo colours under edited features, by their feature state", () => {
		const line = JSON.stringify(paint("indoor-edited-line"));
		expect(line).toContain('["feature-state","edited"]');
		for (const colour of ["rgb(133, 255, 103)", "#fcde5a", "rgb(255, 126, 46)"])
			expect(line).toContain(colour);
	});

	it("hides labels near the pointer", () => {
		expect(paint("indoor-labels")["text-opacity"]).toEqual([
			"case",
			["boolean", ["feature-state", "nearPointer"], false],
			0,
			1,
		]);
	});
});

describe("indoorLayers: rooms by use", () => {
	const fill = (
		presentation: "edit" | "view",
		theme: "light" | "dark" = "light",
	) =>
		JSON.stringify(
			indoorLayers(0, { presentation, theme }).find(
				(l) => l.id === "indoor-fill",
			)?.paint,
		);

	it("fills rooms by their use in the viewer only", () => {
		expect(fill("view")).toContain('["feature-state","use"]');
		expect(fill("view")).toContain("#f3c98b");
		expect(fill("view", "dark")).toContain("#7a5a2c");
		expect(fill("edit")).not.toContain("feature-state");
	});
});

describe("indoorLayers: tracks", () => {
	const track = { "@kind": "line", "@lv": "*", "@rail-r17": "1.2" };

	it("draws a track's two rails, shown only in the viewer", () => {
		expect(drawnBy(0, "LineString", track)).toEqual([
			"indoor-lines",
			"indoor-rails-left",
			"indoor-rails-right",
		]);
		const opacity = (presentation: "edit" | "view", id: string) => {
			const layer = indoorLayers(0, { presentation }).find((l) => l.id === id);
			return (layer?.paint as Record<string, unknown> | undefined)?.[
				"line-opacity"
			];
		};
		expect(opacity("edit", "indoor-rails-left")).toBe(0);
		expect(opacity("view", "indoor-rails-left")).toBe(1);
		expect(opacity("view", "indoor-lines")).toEqual([
			"case",
			["has", "@rail-r17"],
			0,
			1,
		]);
	});
});
