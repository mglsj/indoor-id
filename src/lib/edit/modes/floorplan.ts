/**
 * Floor plan mode: OSM features can't be selected; the plan in Edit can be dragged by its
 * body, corners or rotation handle (previewed live, saved once on release); an alignment tool,
 * when one is on, takes the clicks instead (`floorPlanToolMode`).
 */

import type { LngLat } from "#lib/floorplans/georef.ts";
import type { Message } from "#lib/i18n/messages.ts";
import type { Map as MapLibreMap } from "#lib/map/maplibre.ts";
import type { FloorPlans } from "#lib/state/floorplans.svelte.ts";
import type { Mode } from "../mode.ts";
import { dragTo, GRAB_CURSORS, grabAt } from "../plan-drag.ts";

export interface FloorPlanModeOptions {
	readonly map: MapLibreMap;
	readonly floorplans: FloorPlans;
	/** Leaves floor plan mode (asking about unsaved changes first). */
	readonly close: () => void;
}

export function floorPlanMode({
	map,
	floorplans,
	close,
}: FloorPlanModeOptions): Mode {
	const draggable = () => {
		const plan = floorplans.editing;
		return plan?.visible ? plan : null;
	};
	return {
		name: "floorplan",
		hover(at) {
			const plan = draggable();
			const grab = plan && grabAt(map, plan, at);
			return grab ? GRAB_CURSORS[grab.kind] : "";
		},
		press(at) {
			const plan = draggable();
			const grab = plan && grabAt(map, plan, at);
			if (!plan || !grab) return null;
			return {
				cursor: GRAB_CURSORS[grab.kind],
				move: (to) => floorplans.preview(plan.id, dragTo(plan, grab, to)),
				end: (to) => {
					// Where released: the last move may not have been drawn yet.
					floorplans.preview(plan.id, dragTo(plan, grab, to));
					floorplans.commitPlacement(plan.id);
				},
				cancel: () => floorplans.preview(plan.id, plan.transform),
			};
		},
		key(event) {
			if (event.key !== "Escape") return false;
			close();
			return true;
		},
	};
}

export interface FloorPlanToolModeOptions {
	readonly floorplans: FloorPlans;
	/** A clicked position, moved onto a node or a plan corner near it. */
	readonly snap: (point: { x: number; y: number }, lngLat: LngLat) => LngLat;
	/** The tool's message about the last click. */
	readonly onmessage: (message: Message | null) => void;
	/** Where the pointer is, while the measure line follows it (null: it doesn't). */
	readonly onpointer: (at: LngLat | null) => void;
}

/** An alignment tool on: clicks go to it, snapped (`snap`); Escape turns it off. */
export function floorPlanToolMode({
	floorplans,
	snap,
	onmessage,
	onpointer,
}: FloorPlanToolModeOptions): Mode {
	return {
		name: "floorplan-tool",
		hover(at) {
			// The measure line follows the pointer from the first spot.
			const tool = floorplans.tool;
			const following = tool?.kind === "measure" && tool.points.length === 1;
			onpointer(following ? at.lngLat : null);
			return "crosshair";
		},
		click: (at) => onmessage(floorplans.click(snap(at.point, at.lngLat))),
		leave: () => onpointer(null),
		exit: () => onpointer(null),
		key(event) {
			if (event.key !== "Escape") return false;
			floorplans.setTool(null);
			return true;
		},
	};
}
