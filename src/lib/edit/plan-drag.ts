/**
 * Dragging a floor plan on the map, as in photo editors: its body to move it, a corner handle
 * to resize it (Shift: change the proportions, Ctrl/⌘: from the centre, Alt: move that corner
 * alone), the handle above it to turn it (Shift: in 15° steps). The floor plan mode
 * (`edit/modes/floorplan.ts`) previews moves live and saves them once, on release.
 */

import type { MapPoint } from "#lib/edit/mode.ts";
import {
	dragCorner,
	dragRotation,
	type LngLat,
	type Pixel,
	type Transform,
	translateTo,
	unproject,
} from "#lib/floorplans/georef.ts";
import { HANDLES_LAYER } from "#lib/map/floorplan-layers.ts";
import type { Map as MapLibreMap } from "#lib/map/maplibre.ts";
import type { FloorPlan } from "#lib/state/floorplans.svelte.ts";

/** How far from a corner handle a press still grabs it, in pixels. */
const HANDLE_TOLERANCE = 8;

/** What a press on a plan grabbed. */
export type Grab =
	| { readonly kind: "corner"; readonly corner: number }
	| { readonly kind: "rotate" }
	| { readonly kind: "body"; readonly pixel: Pixel };

/** The cursor over each kind of grab. */
export const GRAB_CURSORS: Record<Grab["kind"], string> = {
	corner: "nwse-resize",
	rotate: "grab",
	body: "move",
};

/** What a press at `at` grabs on `plan`: a corner handle, its rotation handle, the plan, or nothing. */
export function grabAt(
	map: MapLibreMap,
	plan: FloorPlan,
	at: MapPoint,
): Grab | null {
	const { x, y } = at.point;
	const handle = map.getLayer(HANDLES_LAYER)
		? map
				.queryRenderedFeatures(
					[
						[x - HANDLE_TOLERANCE, y - HANDLE_TOLERANCE],
						[x + HANDLE_TOLERANCE, y + HANDLE_TOLERANCE],
					],
					{ layers: [HANDLES_LAYER] },
				)
				.find(
					(f) =>
						f.properties.role === "handle" || f.properties.role === "rotate",
				)
		: undefined;
	if (handle?.properties.role === "rotate") return { kind: "rotate" };
	if (handle)
		return { kind: "corner", corner: Number(handle.properties.corner) };
	const [u, v] = unproject(plan.transform, at.lngLat);
	const { width, height } = plan.size;
	return u >= 0 && v >= 0 && u <= width && v <= height
		? { kind: "body", pixel: [u, v] }
		: null;
}

/**
 * Where dragging what was grabbed to `at` puts the plan. Shift: free proportions (corner) or
 * 15° steps (rotation); Ctrl/⌘: from the centre; Alt: that corner alone.
 */
export function dragTo(plan: FloorPlan, grab: Grab, at: MapPoint): Transform {
	const target: LngLat = at.lngLat;
	const { width, height } = plan.size;
	switch (grab.kind) {
		case "body":
			return translateTo(plan.transform, grab.pixel, target);
		case "rotate":
			return dragRotation(plan.transform, width, height, target, {
				snap: at.shiftKey,
			});
		case "corner":
			return dragCorner(plan.transform, width, height, grab.corner, target, {
				freeAspect: at.shiftKey,
				fromCenter: at.ctrlKey || at.metaKey,
				distort: at.altKey,
			});
	}
}
