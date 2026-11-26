/**
 * What each scope of building mode offers (B.3): on the map, iD's tools for buildings, parts and
 * entrances (point, line, area, the operations that make sense outside, node and side snapping,
 * angle snapping and the length readout), with construction guides (outdoor ones, a set of their
 * own), the measure tool placing them and floor plans to trace; inside a building, everything,
 * CAD precision (C) included. Keys of tools not offered do nothing. Pure.
 */
import type { SnapOption } from "#lib/state/precision.svelte.ts";
import type { Operation } from "./operations.ts";

/** Map mode, or building mode (a building, a level outline or loose indoor data entered). */
export type ScopeName = "map" | "building";

/** The drawing tools of the toolbar. */
export type DrawTool =
	| "point"
	| "line"
	| "area"
	| "rectangle"
	| "split"
	| "measure";

export interface ScopeTools {
	readonly draw: ReadonlySet<DrawTool>;
	/** Whether an operation on the selection is offered. */
	operation(id: Operation["id"]): boolean;
	/** Whether a kind of snap is offered (the snapping menu lists it, snapping uses it). */
	snap(option: SnapOption): boolean;
	/** The grid (`G`), drawing frames, construction guides, typed lengths and inferred lines. */
	readonly grid: boolean;
	readonly frame: boolean;
	readonly guides: boolean;
	readonly typed: boolean;
	/** Floor plans to trace, on the map (a site plan) and inside a building. */
	readonly floorPlans: boolean;
	/** The level switcher: levels are a building's. */
	readonly levels: boolean;
}

const ALL_DRAW: readonly DrawTool[] = [
	"point",
	"line",
	"area",
	"rectangle",
	"split",
	"measure",
];

/** Operations for indoor work only: on levels, or CAD edits measured in a building's frame. */
const INDOOR_OPERATIONS: ReadonlySet<Operation["id"]> = new Set([
	"split",
	"merge",
	"repeat",
	"cut-out",
	"side",
	"offset",
	"square-frame",
]);

/** Snaps map mode keeps: corners, sides and their middles, angles, floor plan corners. */
const MAP_SNAPS: ReadonlySet<SnapOption> = new Set([
	"points",
	"midpoints",
	"angles",
	"planVertices",
]);

const MAP_TOOLS: ScopeTools = {
	draw: new Set<DrawTool>(["point", "line", "area", "measure"]),
	operation: (id) => !INDOOR_OPERATIONS.has(id),
	snap: (option) => MAP_SNAPS.has(option),
	grid: false,
	frame: false,
	guides: true,
	typed: false,
	floorPlans: true,
	levels: false,
};

const BUILDING_TOOLS: ScopeTools = {
	draw: new Set(ALL_DRAW),
	operation: () => true,
	snap: () => true,
	grid: true,
	frame: true,
	guides: true,
	typed: true,
	floorPlans: true,
	levels: true,
};

export function toolsFor(scope: ScopeName): ScopeTools {
	return scope === "map" ? MAP_TOOLS : BUILDING_TOOLS;
}
