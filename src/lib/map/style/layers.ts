/**
 * MapLibre layers drawing the indoor features built by `buildFeatures`. They only read the
 * `@kind`, `@icon`, `@label`, `@restricted`, `@arrow`, `@door-r17` and `@lv` properties, so
 * all tag logic stays in `classify.ts`. Switching level only changes the layers' filters.
 */
import { levelFilter } from "../features.ts";
import type {
	ExpressionSpecification,
	FilterSpecification,
	LayerSpecification,
} from "../maplibre.ts";
import { ARROW_IMAGE, BOTH_ARROWS_IMAGE } from "./arrows.ts";
import {
	type AreaFill,
	type AreaPaint,
	EDIT_COLORS,
	type EditColors,
	INDOOR_COLORS,
	USE_COLORS,
} from "./colors.ts";

export const INDOOR_SOURCE = "osm";
/** The bands of iD's partial fill, built for the areas in view (`map/area-bands.ts`). */
export const BAND_SOURCE = "osm-bands";

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
const isTrack: ExpressionSpecification = ["has", "@rail-r17"];

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

/** A door's half width in pixels at a zoom `scale` times 17's (0 when unknown). */
function doorRadius(scale: number): ExpressionSpecification {
	return ["*", scale, ["to-number", ["coalesce", ["get", "@door-r17"], 0]]];
}

/** iD's colours for edited features (`css/20_map.css`, `.highlight-edited`). */
export const EDITED_COLORS = {
	added: "rgb(133, 255, 103)",
	retagged: "#fcde5a",
	geometry: "rgb(255, 126, 46)",
} as const;

/** How a feature was edited, as the feature state `edited`. */
export type EditKind = keyof typeof EDITED_COLORS;

export const EDITED_LINE_LAYER = "indoor-edited-line";
export const EDITED_POINT_LAYER = "indoor-edited-point";

const edited: ExpressionSpecification = [
	"coalesce",
	["feature-state", "edited"],
	"",
];
const editedColor = [
	"match",
	edited,
	...Object.entries(EDITED_COLORS).flat(),
	"rgba(0, 0, 0, 0)",
] as unknown as ExpressionSpecification;
const editedOpacity: ExpressionSpecification = [
	"case",
	["==", edited, ""],
	0,
	0.6,
];

/** Layers the user can click to select a feature. */
export const SELECTABLE_LAYER_IDS = [
	"indoor-fill",
	"indoor-outline",
	"indoor-lines",
	"indoor-doors",
	"indoor-points",
	"indoor-labels",
];

/** The band inside areas' outlines drawn by the partial fill (iD's default). */
export const FILL_BAND_LAYER = "indoor-fill-band";

/**
 * The layers a click selects from with this fill (iD's `pointer-events`): with the partial fill
 * an area is picked by its band and outline only, so clicks inside a large area (a building, a
 * hall) reach what is drawn there, or the empty floor, rather than the area. The wireframe picks
 * areas by their outline.
 */
export function selectableLayers(fill: AreaFill): string[] {
	if (fill === "full") return SELECTABLE_LAYER_IDS;
	const layers = SELECTABLE_LAYER_IDS.filter((id) => id !== "indoor-fill");
	return fill === "partial" ? [FILL_BAND_LAYER, ...layers] : layers;
}

/** An area's paint in the editor's colours, by kind. */
function byKind(E: EditColors, part: keyof AreaPaint): ExpressionSpecification {
	return [
		"match",
		kind,
		"building",
		E.building[part],
		"space",
		E.space[part],
		"room",
		[
			"case",
			["==", ["get", "@restricted"], "yes"],
			E.restricted[part],
			E.room[part],
		],
		"vertical",
		E.vertical[part],
		"column",
		E.column[part],
		"wall",
		E.wall[part],
		E.area[part],
	] as unknown as ExpressionSpecification;
}

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

/**
 * How the indoor data is drawn (V.1): `edit` keeps fills translucent so floor plans and
 * imagery show through; `view` draws them nearly opaque, as a map to read. 3D comes with 3D.1.
 */
export type Presentation = "edit" | "view";

export interface IndoorStyleOptions {
	/** Fonts available from the basemap's glyph server. */
	readonly textFont?: string[];
	readonly presentation?: Presentation;
	/** How areas are filled while editing; the viewer fills them whole. */
	readonly fill?: AreaFill;
}

/**
 * In the viewer, a room's use (feature state `use`, set by `IndoorMap.setUses`) picks its fill
 * before its kind does; the editor draws kinds only.
 */
function byUse(
	presentation: Presentation,
	byKind: ExpressionSpecification,
): ExpressionSpecification {
	if (presentation !== "view") return byKind;
	return [
		"match",
		["coalesce", ["feature-state", "use"], ""],
		...Object.entries(USE_COLORS).flat(),
		byKind,
	] as unknown as ExpressionSpecification;
}

export function indoorLayers(
	level: number,
	{
		textFont = LABEL_FONT,
		presentation = "edit",
		fill = "partial",
	}: IndoorStyleOptions = {},
): LayerSpecification[] {
	const C = INDOOR_COLORS;
	const E = EDIT_COLORS;
	const editing = presentation === "edit";
	const wireframe = editing && fill === "wireframe";
	/** One rail of the tracks, `side` 1 or -1 of the centre line, `@rail-r17` pixels at z17. */
	const rail = (id: string, side: 1 | -1): LayerSpecification => ({
		id,
		type: "line",
		source: INDOOR_SOURCE,
		filter: onLevel(["all", isLine, isTrack]),
		paint: {
			"line-color": C.wall,
			"line-width": width(0.5, 2),
			"line-offset": [
				"interpolate",
				["exponential", 2],
				["zoom"],
				17,
				["*", side, ["to-number", ["get", "@rail-r17"]]],
				22,
				["*", side * 32, ["to-number", ["get", "@rail-r17"]]],
			],
			"line-opacity": presentation === "view" ? 1 : 0,
		},
	});
	const fillOpacity: ExpressionSpecification = [
		"match",
		kind,
		"building",
		0.85,
		0.95,
	];
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
			paint: editing
				? {
						"fill-color": byKind(E, "fill"),
						"fill-opacity": fill === "full" ? 1 : 0,
					}
				: {
						"fill-color": byUse(presentation, [
							"match",
							kind,
							"building",
							C.building,
							"space",
							C.space,
							"room",
							[
								"case",
								["==", ["get", "@restricted"], "yes"],
								C.restricted,
								C.room,
							],
							"vertical",
							C.vertical,
							"column",
							C.column,
							"wall",
							C.wall,
							C.area,
						]),
						"fill-opacity": fillOpacity,
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
			// iD's partial fill: the band inside each outline, built as a shape (`area-bands.ts`).
			id: FILL_BAND_LAYER,
			type: "fill",
			source: BAND_SOURCE,
			filter: onLevel(isPolygon),
			paint: {
				"fill-color": byKind(E, "fill"),
				"fill-opacity": editing && fill === "partial" ? 1 : 0,
			},
		},
		{
			// iD's "Highlight changes": a halo under what was added, retagged or reshaped.
			id: EDITED_LINE_LAYER,
			type: "line",
			source: INDOOR_SOURCE,
			filter: onLevel(["any", isPolygon, isLine]),
			layout: { "line-join": "round", "line-cap": "round" },
			paint: {
				"line-color": editedColor,
				"line-width": wireframe ? 3 : 16,
				"line-opacity": editedOpacity,
			},
		},
		{
			id: "indoor-outline",
			type: "line",
			source: INDOOR_SOURCE,
			filter: onLevel(isPolygon),
			paint: {
				"line-color": editing
					? byKind(E, "stroke")
					: [
							"match",
							kind,
							["space", "area"],
							C.softOutline,
							"vertical",
							C.verticalOutline,
							C.wall,
						],
				"line-width": wireframe
					? 1
					: widthByKind(
							[
								[["space", "area"], editing ? 0.6 : 0.3, editing ? 2 : 1],
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
				"line-color": editing
					? [
							"match",
							kind,
							"wall",
							E.wallLine,
							"path",
							[
								"match",
								["get", "highway"],
								"steps",
								E.steps,
								"corridor",
								E.corridor,
								E.footway,
							],
							"door",
							C.door,
							"passage",
							C.passageStroke,
							E.line,
						]
					: [
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
				"line-width": wireframe
					? 1
					: widthByKind(
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
				// The viewer draws tracks as their two rails instead.
				"line-opacity": presentation === "view" ? ["case", isTrack, 0, 1] : 1,
			},
		},
		rail("indoor-rails-left", 1),
		rail("indoor-rails-right", -1),
		{
			id: EDITED_POINT_LAYER,
			type: "circle",
			source: INDOOR_SOURCE,
			filter: onLevel(isPoint),
			paint: {
				"circle-radius": 10,
				"circle-color": editedColor,
				"circle-opacity": editedOpacity,
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
				// As wide as the door when its width is known, never smaller than other doors.
				"circle-radius": [
					"interpolate",
					["exponential", 2],
					["zoom"],
					17,
					["max", 1.5, doorRadius(1)],
					22,
					["max", 8, doorRadius(32)],
				],
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
			// Which way steps and ramps go up, and escalators and moving walkways move.
			id: "indoor-arrows",
			type: "symbol",
			source: INDOOR_SOURCE,
			filter: onLevel(["all", isLine, ["has", "@arrow"]]),
			layout: {
				"symbol-placement": "line",
				"symbol-spacing": 40,
				"icon-image": [
					"case",
					["==", ["get", "@arrow"], "both"],
					BOTH_ARROWS_IMAGE,
					ARROW_IMAGE,
				],
				"icon-rotate": ["case", ["==", ["get", "@arrow"], "backward"], 180, 0],
				"icon-rotation-alignment": "map",
				"icon-allow-overlap": true,
				"icon-ignore-placement": true,
			},
		},
		{
			// Points with neither an icon nor a name still show, and can be selected.
			id: "indoor-points",
			type: "circle",
			source: INDOOR_SOURCE,
			filter: onLevel([
				"all",
				isPoint,
				["!", ["in", kind, ["literal", ["door", "passage"]]]],
				["!", ["has", "@icon"]],
				["!", ["has", "@label"]],
			]),
			paint: {
				"circle-radius": width(2, 6),
				"circle-color": C.point,
				"circle-stroke-color": C.pointStroke,
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
				// iD hides the labels around the pointer, to see what they cover.
				"text-opacity": [
					"case",
					["boolean", ["feature-state", "nearPointer"], false],
					0,
					1,
				],
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
