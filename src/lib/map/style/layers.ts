/**
 * MapLibre layers drawing the indoor features built by `buildFeatures`. They only read the
 * `@kind`, `@icon`, `@label`, `@restricted` and `@lv` properties, so all tag logic stays in
 * `classify.ts`. Switching level only changes the layers' filters.
 */
import { levelFilter } from "../features.ts";
import type {
	ExpressionSpecification,
	FilterSpecification,
	LayerSpecification,
} from "../maplibre.ts";
import { INDOOR_COLORS as C } from "./colors.ts";

export const INDOOR_SOURCE = "osm";

const kind: ExpressionSpecification = ["get", "@kind"];
const isPolygon: ExpressionSpecification = [
	"in",
	["geometry-type"],
	["literal", ["Polygon", "MultiPolygon"]],
];
const isLine: ExpressionSpecification = [
	"in",
	["geometry-type"],
	["literal", ["LineString", "MultiLineString"]],
];
const isPoint: ExpressionSpecification = ["==", ["geometry-type"], "Point"];

/** Width growing with zoom like real-world sizes, from `at17` px at z17 to `at22` px at z22. */
function width(at17: number, at22: number): ExpressionSpecification {
	return ["interpolate", ["exponential", 2], ["zoom"], 17, at17, 22, at22];
}

type WidthCase = readonly [
	kinds: string | string[],
	at17: number,
	at22: number,
];

/**
 * Width by feature kind, growing with zoom. MapLibre allows a single zoom interpolation at the
 * top of an expression, so the kind is matched inside each zoom stop.
 */
function widthByKind(
	cases: readonly WidthCase[],
	fallback: readonly [number, number],
): ExpressionSpecification {
	const at = (stop: 1 | 2): ExpressionSpecification =>
		[
			"match",
			kind,
			...cases.flatMap((c) => [c[0], c[stop]]),
			fallback[stop - 1],
		] as unknown as ExpressionSpecification;
	return ["interpolate", ["exponential", 2], ["zoom"], 17, at(1), 22, at(2)];
}

/** Layers the user can click to select a feature. */
export const SELECTABLE_LAYER_IDS = [
	"indoor-fill",
	"indoor-outline",
	"indoor-lines",
	"indoor-doors",
	"indoor-labels",
];

const isSelected: ExpressionSpecification = [
	"boolean",
	["feature-state", "selected"],
	false,
];
const isHovered: ExpressionSpecification = [
	"boolean",
	["feature-state", "hover"],
	false,
];
/** The selection outline: full when selected, faint under the pointer (as iD). */
const outlineOpacity: ExpressionSpecification = [
	"case",
	isSelected,
	1,
	isHovered,
	0.45,
	0,
];

/** The labels' font, when the basemap names none. */
export const LABEL_FONT = ["Noto Sans Regular"];

export interface IndoorStyleOptions {
	/** Fonts available from the basemap's glyph server. */
	readonly textFont?: string[];
}

export function indoorLayers(
	level: number,
	{ textFont = LABEL_FONT }: IndoorStyleOptions = {},
): LayerSpecification[] {
	const onLevel = (filter: ExpressionSpecification): FilterSpecification => [
		"all",
		filter,
		levelFilter(level) as ExpressionSpecification,
	];

	return [
		{
			id: "indoor-fill",
			type: "fill",
			source: INDOOR_SOURCE,
			filter: onLevel(isPolygon),
			paint: {
				"fill-color": [
					"match",
					kind,
					"building",
					C.building,
					"space",
					C.space,
					"room",
					["case", ["==", ["get", "@restricted"], "yes"], C.restricted, C.room],
					"vertical",
					C.vertical,
					"column",
					C.column,
					"wall",
					C.wall,
					C.area,
				],
				"fill-opacity": ["match", kind, "building", 0.5, "wall", 0.9, 0.8],
			},
			layout: {
				// Containers below their contents: building, open spaces, rooms, then the rest.
				"fill-sort-key": [
					"match",
					kind,
					"building",
					0,
					"area",
					1,
					"space",
					2,
					"room",
					3,
					4,
				],
			},
		},
		{
			id: "indoor-outline",
			type: "line",
			source: INDOOR_SOURCE,
			filter: onLevel(isPolygon),
			paint: {
				"line-color": [
					"match",
					kind,
					["space", "area"],
					C.softOutline,
					"vertical",
					C.verticalOutline,
					C.wall,
				],
				"line-width": widthByKind(
					[
						[["space", "area"], 0.3, 1],
						["vertical", 0.8, 3],
					],
					[0.6, 6],
				),
			},
		},
		{
			id: "indoor-lines",
			type: "line",
			source: INDOOR_SOURCE,
			filter: onLevel(isLine),
			paint: {
				"line-color": [
					"match",
					kind,
					"wall",
					C.wall,
					"path",
					C.path,
					"door",
					C.door,
					"passage",
					C.passageStroke,
					C.line,
				],
				"line-width": widthByKind(
					[
						["wall", 0.6, 6],
						[["door", "passage"], 2, 12],
					],
					[1, 4],
				),
				"line-dasharray": [
					"case",
					["==", ["get", "highway"], "steps"],
					["literal", [0.6, 0.4]],
					["literal", [1, 0]],
				],
			},
		},
		{
			id: "indoor-doors",
			type: "circle",
			source: INDOOR_SOURCE,
			filter: onLevel([
				"all",
				isPoint,
				["in", kind, ["literal", ["door", "passage"]]],
			]),
			paint: {
				"circle-radius": width(1.5, 8),
				"circle-color": ["match", kind, "door", C.door, C.passage],
				"circle-stroke-color": [
					"match",
					kind,
					"door",
					C.doorStroke,
					C.passageStroke,
				],
				"circle-stroke-width": 1,
			},
		},
		{
			id: "indoor-labels",
			type: "symbol",
			source: INDOOR_SOURCE,
			filter: onLevel([
				"all",
				["any", isPoint, isPolygon],
				["any", ["has", "@icon"], ["has", "@label"]],
			]),
			layout: {
				"icon-image": ["coalesce", ["get", "@icon"], ""],
				"icon-size": 0.5,
				"text-field": ["coalesce", ["get", "@label"], ""],
				"text-font": textFont,
				"text-size": 12,
				"text-anchor": ["case", ["has", "@icon"], "top", "center"],
				"text-offset": [
					"case",
					["has", "@icon"],
					["literal", [0, 0.8]],
					["literal", [0, 0]],
				],
				"text-max-width": 8,
				"text-optional": true,
			},
			paint: {
				"text-color": C.text,
				"text-halo-color": C.textHalo,
				"text-halo-width": 1.2,
			},
		},
		{
			id: "indoor-selection-line",
			type: "line",
			source: INDOOR_SOURCE,
			filter: onLevel(["any", isPolygon, isLine]),
			paint: {
				"line-color": C.selection,
				"line-width": 3,
				"line-opacity": outlineOpacity,
			},
		},
		{
			id: "indoor-selection-point",
			type: "circle",
			source: INDOOR_SOURCE,
			filter: onLevel(isPoint),
			paint: {
				"circle-radius": 12,
				"circle-color": "rgba(0, 0, 0, 0)",
				"circle-stroke-color": C.selection,
				"circle-stroke-width": 3,
				"circle-stroke-opacity": outlineOpacity,
			},
		},
	];
}
