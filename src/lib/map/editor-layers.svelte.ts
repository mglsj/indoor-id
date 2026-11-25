/**
 * The editor's own map layers (R6.4, R1: out of `EditorView`): the edit overlay, snapping
 * feedback, construction guides, the grid and the floor plans with their tool marks. Each layer
 * is made once and follows its input in an effect, so call `attachEditorLayers` inside the
 * effect that holds the map: the layers' effects end with it, then call `remove()`.
 */
import type { FeatureCollection } from "geojson";
import { untrack } from "svelte";
import type { ConstructionGuide } from "#lib/edit/precision/construction.ts";
import type { Feedback } from "#lib/edit/precision/feedback.ts";
import type { GridLine } from "#lib/edit/precision/grid.ts";
import { ConstructionLayer } from "#lib/map/construction-layer.ts";
import { EditOverlay } from "#lib/map/edit-overlay.ts";
import { FloorPlanLayers, PlanToolLayer } from "#lib/map/floorplan-layers.ts";
import { GridLayer, type GridStyle } from "#lib/map/grid-layer.ts";
import { GuideLayer } from "#lib/map/guide-layer.ts";
import type { IndoorMap } from "#lib/map/indoor-map.ts";
import type { Map as MapLibreMap } from "#lib/map/maplibre.ts";
import type { FloorPlans } from "#lib/state/floorplans.svelte.ts";

/** What the layers show, read in their effects: each one follows what its function reads. */
export interface EditorLayerInputs {
	readonly floorplans: FloorPlans;
	planMode(): boolean;
	level(): number;
	/** The overlay's vertices, midpoints, unmapped floor and cut line. */
	overlay(): Parameters<EditOverlay["setData"]>[0];
	selectionColor(): string;
	/** The snap and measures a mode shows. */
	feedback(): Feedback | null;
	/** Whether arrow keys nudge the selection, rather than pan the map (C.6). */
	nudging(): boolean;
	guides(): readonly ConstructionGuide[];
	highlightedGuide(): string | null;
	gridStyle(): GridStyle;
	gridLines(): readonly GridLine[];
	/** Plan frames and the alignment tool's marks. */
	planMarks(): FeatureCollection;
	/** Plan tiles waiting to be drawn. */
	ontiles(count: number): void;
}

export interface EditorLayers {
	/** For what a press grabs (a vertex, a midpoint). */
	readonly overlay: EditOverlay;
	remove(): void;
}

export function attachEditorLayers(
	map: MapLibreMap,
	indoor: IndoorMap,
	inputs: EditorLayerInputs,
): EditorLayers {
	const { floorplans } = inputs;
	$effect(() => indoor.setPlanMode(inputs.planMode()));
	$effect(() => indoor.setBuildingsVisible(floorplans.buildings.visible));

	const overlay = new EditOverlay(map);
	$effect(() => overlay.setSelectionColor(inputs.selectionColor()));
	$effect(() => overlay.setData(inputs.overlay()));

	const feedback = new GuideLayer(map);
	$effect(() => feedback.show(inputs.feedback()));

	$effect(() => {
		if (inputs.nudging()) map.keyboard.disable();
		else map.keyboard.enable();
	});

	const construction = new ConstructionLayer(map);
	$effect(() =>
		construction.setGuides(inputs.guides(), inputs.highlightedGuide()),
	);

	const grid = new GridLayer(map, untrack(inputs.gridStyle));
	$effect(() => grid.setStyle(inputs.gridStyle()));
	$effect(() => grid.setLines(inputs.gridLines()));

	const plans = new FloorPlanLayers(map, floorplans.tiles);
	const stopTiles = plans.onTiles(inputs.ontiles);
	const marks = new PlanToolLayer(map);
	$effect(() => plans.setLayers(floorplans.layers));
	// A copy: reading every entry follows content added or dropped.
	$effect(() => plans.setContents(new Map(floorplans.contents)));
	$effect(() => plans.setLevel(inputs.level()));
	// Plan content is kept for the level shown (and the plan in Edit) only.
	$effect(() => floorplans.showLevel(inputs.level()));
	$effect(() => marks.setData(inputs.planMarks()));

	return {
		overlay,
		remove() {
			stopTiles();
			overlay.remove();
			feedback.remove();
			grid.remove();
			construction.remove();
			marks.remove();
			plans.remove();
		},
	};
}
