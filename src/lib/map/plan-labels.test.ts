import {
	expression,
	type StyleSpecification,
	validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import type { Transform } from "#lib/floorplans/georef.ts";
import type { VectorContent, VectorText } from "#lib/floorplans/vector.ts";
import { fromMercator } from "#lib/osm/geometry.ts";
import {
	LABEL_MAX_SIZE,
	LABEL_MIN_SIZE,
	planLabelLayer,
	planLabels,
} from "./plan-labels.ts";

/** Web Mercator's circumference, in metres: 512 px at zoom 0. */
const CIRCUMFERENCE = 2 * Math.PI * 6378137;

/**
 * A plan placed `scale` Mercator metres a unit from (0, 0), its x axis turned `bearing`
 * degrees clockwise from east (Mercator y runs up, plan y down).
 */
function placed(scale = 1, bearing = 0): Transform {
	const c = Math.cos((bearing * Math.PI) / 180) * scale;
	const s = Math.sin((bearing * Math.PI) / 180) * scale;
	return { kind: "similarity", matrix: [c, -s, 0, -s, -c, 0, 0, 0, 1] };
}

function vector(
	texts: VectorText[],
	layers: VectorContent["layers"] = [],
): VectorContent {
	return {
		size: { width: 1000, height: 1000 },
		segments: new Float32Array(),
		segmentStyles: new Uint32Array(),
		triangles: new Float32Array(),
		triangleStyles: new Uint32Array(),
		styles: [],
		texts,
		layers,
	};
}

const text = (fields: Partial<VectorText>): VectorText => ({
	text: "Hall",
	x: 0,
	y: 0,
	size: 10,
	angle: 0,
	layer: -1,
	...fields,
});

describe("planLabels: a vector plan's text as map points", () => {
	it("places each text through the plan's transform", () => {
		const [label] = planLabels(
			vector([text({ x: 100, y: 50 })]),
			placed(),
		).features;
		const [lon = 0, lat = 0] = label?.geometry.coordinates ?? [];
		const [expectedLon, expectedLat] = fromMercator([100, -50]);
		expect(lon).toBeCloseTo(expectedLon, 12);
		expect(lat).toBeCloseTo(expectedLat, 12);
		expect(label?.properties.text).toBe("Hall");
	});

	it("turns text with the plan, clockwise on the map", () => {
		const labels = planLabels(
			vector([text({ angle: 0 }), text({ angle: -90 })]),
			placed(1, 30),
		);
		const rotations = labels.features.map((f) => f.properties.rotate);
		expect(rotations[0]).toBeCloseTo(30, 9);
		expect(rotations[1]).toBeCloseTo(-60, 9);
	});

	it("gives its size in pixels at zoom 0: the 512 px world spans the circumference", () => {
		const sizes = (scale: number) =>
			planLabels(vector([text({ size: 10 })]), placed(scale)).features.map(
				(f) => f.properties.size,
			);
		expect(sizes(1)[0]).toBeCloseTo((10 * 512) / CIRCUMFERENCE, 15);
		expect(sizes(2)[0]).toBeCloseTo((20 * 512) / CIRCUMFERENCE, 15);
	});

	it("leaves out the text of hidden CAD layers", () => {
		const labels = planLabels(
			vector(
				[
					text({ text: "Wall", layer: 0 }),
					text({ text: "Bed", layer: 1 }),
					text({ text: "Free" }),
				],
				[
					{ id: "7R", name: "Walls", visible: true },
					{ id: "9R", name: "Furniture", visible: true },
				],
			),
			placed(),
			new Set(["9R"]),
		);
		expect(labels.features.map((f) => f.properties.text)).toEqual([
			"Wall",
			"Free",
		]);
	});
});

describe("planLabelLayer: plan text drawn dark with a light halo", () => {
	const layer = planLabelLayer("labels", "labels", 0.5);

	/** The layer's `property` for a label `size` px tall at zoom 0, at `zoom`. */
	function evaluate(
		kind: "layout" | "paint",
		property: string,
		size: number,
		zoom: number,
	): number {
		const value = (layer[kind] as Record<string, unknown>)[property];
		const parsed = expression.createExpression(
			value,
			`layers[0].${kind}.${property}`,
		);
		if (parsed.result !== "success") throw new Error(String(parsed.value));
		return parsed.value.evaluate({ zoom }, {
			type: 1,
			properties: { size },
		} as never) as number;
	}

	it("is a valid MapLibre layer, text turned with the plan and never hidden by collisions", () => {
		const style: StyleSpecification = {
			version: 8,
			glyphs: "https://example.org/fonts/{fontstack}/{range}.pbf",
			sources: {
				labels: {
					type: "geojson",
					data: { type: "FeatureCollection", features: [] },
				},
			},
			layers: [layer],
		};
		expect(validateStyleMin(style)).toEqual([]);
		expect(layer.layout).toMatchObject({
			"text-rotate": ["get", "rotate"],
			"text-rotation-alignment": "map",
			"text-allow-overlap": true,
			"text-ignore-placement": true,
		});
	});

	it("doubles text with each zoom level, up to 250 px", () => {
		expect(evaluate("layout", "text-size", 0.01, 10)).toBeCloseTo(10.24, 9);
		expect(evaluate("layout", "text-size", 0.01, 11)).toBeCloseTo(20.48, 9);
		expect(evaluate("layout", "text-size", 0.01, 10.5)).toBeCloseTo(
			10.24 * Math.SQRT2,
			9,
		);
		expect(evaluate("layout", "text-size", 0.01, 15)).toBe(LABEL_MAX_SIZE);
	});

	it("hides text under 6 px, fading it in on the zoom level before, at the plan's opacity", () => {
		expect(LABEL_MIN_SIZE).toBe(6);
		// 0.01 px at zoom 0: 5.12 px at zoom 9, 10.24 px at zoom 10.
		expect(evaluate("paint", "text-opacity", 0.01, 9)).toBe(0);
		expect(evaluate("paint", "text-opacity", 0.01, 9.5)).toBeCloseTo(0.25, 9);
		expect(evaluate("paint", "text-opacity", 0.01, 10)).toBe(0.5);
		expect(evaluate("paint", "text-opacity", 0.01, 20)).toBe(0.5);
	});
});
