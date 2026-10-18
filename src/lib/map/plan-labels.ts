/**
 * A vector plan's text as map labels: one GeoJSON point per text through the plan's transform,
 * with its size in pixels at zoom 0 and its rotation on the map, both measured on the spot (a
 * projective plan's scale and angle vary across it). The layer draws them dark with a light
 * halo, turned with the plan, doubling with each zoom level like the plan does, and hidden
 * while too small to read. Pure.
 */
import type { FeatureCollection, Point } from "geojson";
import { project, type Transform } from "#lib/floorplans/georef.ts";
import type { VectorContent } from "#lib/floorplans/vector.ts";
import { EARTH_RADIUS } from "#lib/osm/geometry.ts";
import type {
	ExpressionSpecification,
	SymbolLayerSpecification,
} from "./maplibre.ts";
import { INDOOR_COLORS as C } from "./style/colors.ts";
import { LABEL_FONT } from "./style/layers.ts";

/** Text smaller than this, in pixels, isn't shown. */
export const LABEL_MIN_SIZE = 6;
/** Text stops growing at this size, in pixels: MapLibre can't draw text of 255 px or more. */
export const LABEL_MAX_SIZE = 250;
/** Zoom levels whose sizes the layer gives exactly; it interpolates between them. */
const MAX_ZOOM = 24;

export interface LabelProperties {
	readonly text: string;
	/** Height of an em in pixels at zoom 0 (a 512 px world): it doubles with each level. */
	readonly size: number;
	/** Degrees clockwise from east, the way the text reads on the map. */
	readonly rotate: number;
}

/** Pixels a Mercator metre spans at zoom 0. */
const PIXELS_PER_METRE = 512 / (2 * Math.PI * EARTH_RADIUS);

/** The plan's text, but for that of the CAD layers in `hidden` (by id), as map points. */
export function planLabels(
	content: VectorContent,
	transform: Transform,
	hidden: ReadonlySet<string> = new Set(),
): FeatureCollection<Point, LabelProperties> {
	const m = transform.matrix;
	const mercator = (u: number, v: number): [number, number] => {
		const w = m[6] * u + m[7] * v + m[8];
		return [(m[0] * u + m[1] * v + m[2]) / w, (m[3] * u + m[4] * v + m[5]) / w];
	};
	const shown = content.texts.filter(
		(t) => t.layer < 0 || !hidden.has(content.layers[t.layer]?.id ?? ""),
	);
	return {
		type: "FeatureCollection",
		features: shown.map(({ text, x, y, size, angle }) => {
			const radians = (angle * Math.PI) / 180;
			const [cx, cy] = mercator(x, y);
			// One em along the line and one up it (y runs down), in Mercator metres.
			const [ax, ay] = mercator(
				x + Math.cos(radians) * size,
				y + Math.sin(radians) * size,
			);
			const [ux, uy] = mercator(
				x + Math.sin(radians) * size,
				y - Math.cos(radians) * size,
			);
			return {
				type: "Feature",
				geometry: { type: "Point", coordinates: project(transform, [x, y]) },
				properties: {
					text,
					size: Math.hypot(ux - cx, uy - cy) * PIXELS_PER_METRE,
					// Mercator y runs up: clockwise is towards -y.
					rotate: (Math.atan2(cy - ay, ax - cx) * 180) / Math.PI + 0,
				},
			};
		}),
	};
}

/** One stop per zoom level, `value(scale)` with `scale` = 2^zoom. */
function perZoom(
	kind: ExpressionSpecification[1],
	value: (scale: number) => ExpressionSpecification | number,
): ExpressionSpecification {
	const stops = Array.from({ length: MAX_ZOOM + 1 }, (_, z) => [
		z,
		value(2 ** z),
	]).flat();
	return ["interpolate", kind, ["zoom"], ...stops] as ExpressionSpecification;
}

const size: ExpressionSpecification = ["get", "size"];

/** Text opacity: the plan's, from the zoom level where a label reaches LABEL_MIN_SIZE. */
export function labelOpacity(opacity: number): ExpressionSpecification {
	return perZoom(["linear"], (scale) => [
		"case",
		[">=", size, LABEL_MIN_SIZE / scale],
		opacity,
		0,
	]);
}

/** The symbol layer drawing `planLabels` from `source`, at the plan's `opacity`. */
export function planLabelLayer(
	id: string,
	source: string,
	opacity: number,
	font: string[] = LABEL_FONT,
): SymbolLayerSpecification {
	return {
		id,
		type: "symbol",
		source,
		layout: {
			"text-field": ["get", "text"],
			"text-font": font,
			"text-size": perZoom(["exponential", 2], (scale) => [
				"min",
				["*", size, scale],
				LABEL_MAX_SIZE,
			]),
			"text-rotate": ["get", "rotate"],
			"text-rotation-alignment": "map",
			"text-pitch-alignment": "map",
			"text-anchor": "center",
			// A plan's line is never wrapped, and all of its text shows, over or under OSM labels.
			"text-max-width": 1000,
			"text-allow-overlap": true,
			"text-ignore-placement": true,
			"text-padding": 0,
		},
		paint: {
			"text-color": C.text,
			"text-halo-color": C.textHalo,
			"text-halo-width": 1.2,
			"text-opacity": labelOpacity(opacity),
		},
	};
}
