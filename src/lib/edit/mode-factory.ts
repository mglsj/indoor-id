/**
 * Which editing mode is on, and the mode itself (R6.4, R1: out of `EditorView`). The view says
 * what is on (`modeKindOf`) and gives a `ModeHost`; `modeFor` starts the mode with the shared
 * parts (history, level, snapping, precision) and asks the host only for the options of the
 * mode started.
 */
import type { MapPoint, Mode } from "#lib/edit/mode.ts";
import { type BrowseOptions, browseMode } from "#lib/edit/modes/browse.ts";
import {
	type DrawOptions,
	type DrawPrecision,
	type DrawSnap,
	type DrawTracing,
	drawPointMode,
	drawWayMode,
} from "#lib/edit/modes/draw.ts";
import {
	type FloorPlanModeOptions,
	type FloorPlanToolModeOptions,
	floorPlanMode,
	floorPlanToolMode,
} from "#lib/edit/modes/floorplan.ts";
import {
	type FramePick,
	type FramePickOptions,
	framePickMode,
} from "#lib/edit/modes/frame-pick.ts";
import {
	type MeasureMode,
	type MeasureOptions,
	measureMode,
} from "#lib/edit/modes/measure.ts";
import {
	drawRectangleMode,
	type RectangleVariant,
} from "#lib/edit/modes/rectangle.ts";
import { type SplitOptions, splitMode } from "#lib/edit/modes/split.ts";
import {
	type TransformOptions,
	type TransformTool,
	transformMode,
} from "#lib/edit/modes/transform.ts";
import type { Inferences } from "#lib/edit/precision/inference.ts";
import type { DirectionLine, SnapTarget } from "#lib/edit/precision/snap.ts";
import type { EntityId } from "#lib/osm/entity.ts";

/** The drawing tools of the toolbar (P5.3.4), the split tool (P5.3.5) and measuring (C.5). */
export type DrawingTool =
	| "point"
	| "line"
	| "area"
	| "rectangle"
	| "split"
	| "measure";

export type ModeKind =
	| "browse"
	| `draw-${DrawingTool}`
	| `transform-${TransformTool}`
	| `frame-${FramePick}`
	| "floorplan"
	| "floorplan-tool";

/** What is on in the editor, which decides the mode. */
export interface ModeState {
	readonly planMode: boolean;
	/** An alignment tool of floor plan mode is on. */
	readonly planTool: boolean;
	readonly framePick: FramePick | null;
	readonly transformTool: TransformTool | null;
	readonly drawing: DrawingTool | null;
}

/**
 * The mode for what is on: floor plan mode (its tool first), then picking a frame, a transform
 * tool, a drawing tool, else browsing.
 */
export function modeKindOf(state: ModeState): ModeKind {
	if (state.planMode) return state.planTool ? "floorplan-tool" : "floorplan";
	if (state.framePick) return `frame-${state.framePick}`;
	if (state.transformTool) return `transform-${state.transformTool}`;
	if (state.drawing) return `draw-${state.drawing}`;
	return "browse";
}

/** What the modes need from the editor. The option builders are called when their mode starts. */
export interface ModeHost {
	readonly history: DrawOptions["history"];
	/** The level shown, read once when a drawing starts: it draws on that level. */
	level(): number;
	readonly snap: DrawSnap;
	/** Frame, angle step, units and feedback, shared by the precise tools. */
	readonly precision: Pick<
		DrawPrecision,
		"frameAt" | "step" | "units" | "show"
	>;
	readonly inferences: Inferences | undefined;
	/** Whether lengths and angles can be typed while drawing lines and areas (B.3). */
	readonly typed: boolean;
	/** The construction guides shown, which measuring snaps along. */
	guides(): readonly DirectionLine[];
	/** A drawing ended: the feature made, or null. */
	ondrawn(id: EntityId | null): void;
	/** The line or area being drawn, null once it ends. */
	ondrawing(id: EntityId | null): void;
	readonly tracing: DrawTracing;
	onrectangle(variant: RectangleVariant): void;
	/** The measure tool started, for the toolbar's Measure / Guide switch. */
	onmeasure(tool: MeasureMode): void;
	browse(): BrowseOptions;
	transform(): Pick<TransformOptions, "ids" | "nodes" | "onfinish">;
	measure(): Omit<MeasureOptions, "snap" | "precision" | "guides">;
	framePick(): Omit<FramePickOptions, "pick" | "snap"> & {
		/** The side at a point, which aligning the frame picks. */
		snapSide(at: MapPoint): SnapTarget | null;
	};
	split(): Omit<SplitOptions, "snap">;
	floorplan(): FloorPlanModeOptions;
	floorplanTool(): FloorPlanToolModeOptions;
}

const NONE: ReadonlySet<never> = new Set();

export function modeFor(kind: ModeKind, host: ModeHost): Mode {
	const { history, snap, precision } = host;
	switch (kind) {
		case "browse":
			return browseMode(host.browse());
		case "draw-point":
			return drawPointMode({
				history,
				level: host.level(),
				snap,
				onfinish: host.ondrawn,
			});
		case "draw-line":
		case "draw-area":
			return drawWayMode(kind === "draw-line" ? "line" : "area", {
				history,
				level: host.level(),
				snap,
				onfinish: host.ondrawn,
				ondrawing: host.ondrawing,
				precision: {
					...precision,
					inferences: host.inferences,
					typed: host.typed,
				},
				tracing: host.tracing,
			});
		case "draw-rectangle":
			return drawRectangleMode({
				history,
				level: host.level(),
				snap,
				onfinish: host.ondrawn,
				onvariant: host.onrectangle,
				precision,
			});
		case "draw-measure": {
			const tool = measureMode({
				...host.measure(),
				snap,
				precision,
				guides: host.guides,
			});
			host.onmeasure(tool);
			return tool;
		}
		case "draw-split":
			return splitMode({
				...host.split(),
				snap: (at) => snap(at, NONE)?.loc ?? null,
			});
		case "transform-move":
		case "transform-rotate":
		case "transform-scale":
		case "transform-side":
		case "transform-offset":
			return transformMode({
				...host.transform(),
				tool: kind.slice("transform-".length) as TransformTool,
				history,
				snap,
				precision,
			});
		case "frame-align":
		case "frame-origin": {
			const { snapSide, ...options } = host.framePick();
			const pick = kind === "frame-align" ? "align" : "origin";
			return framePickMode({
				...options,
				pick,
				snap: pick === "align" ? snapSide : (at) => snap(at, NONE),
			});
		}
		case "floorplan":
			return floorPlanMode(host.floorplan());
		case "floorplan-tool":
			return floorPlanToolMode(host.floorplanTool());
	}
}
