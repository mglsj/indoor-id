/**
 * Browsing the map: a click selects the feature under it (or clears the selection), the
 * feature under the pointer is hovered and the cursor shows it can be selected, Escape clears
 * the selection; a Shift+click adds the feature to the selection or takes it out. The edit overlay's vertices and midpoints come first: a click on a vertex
 * selects it, a press on one drags it (`drag`).
 */
import type { Drag, MapPoint, Mode } from "../mode.ts";

export interface BrowseOptions {
	/** The feature drawn at a screen point, topmost first, if any. */
	readonly hitTest: (point: { x: number; y: number }) => string | null;
	readonly select: (id: string | null) => void;
	/** The feature under the pointer, or null. */
	readonly hover: (id: string | null) => void;
	/** What a press at this point would drag (a vertex, a midpoint, the selected point). */
	readonly drag?: (at: MapPoint) => Drag | null;
	/** Whether a press at this point would drag something (the cursor shows it). */
	readonly draggable?: (point: { x: number; y: number }) => boolean;
	/** The overlay's vertex at a screen point, which a click selects. */
	readonly vertexAt?: (point: { x: number; y: number }) => string | null;
	/** Adds a feature to the selection, or takes it out (Shift+click). */
	readonly toggle?: (id: string) => void;
	/** Where the pointer is on the map (where a paste goes), null once it left. */
	readonly pointer?: (at: MapPoint | null) => void;
}

export function browseMode({
	hitTest,
	select,
	hover,
	drag,
	draggable,
	vertexAt,
	toggle,
	pointer,
}: BrowseOptions): Mode {
	return {
		name: "browse",
		// Shift+click selects several features: MapLibre's Shift+drag zoom would take the click.
		gestures: toggle ? { boxZoom: false } : undefined,
		hover(at) {
			pointer?.(at);
			// Over a vertex the way stays hovered: its vertices stay shown.
			if (draggable?.(at.point)) return "move";
			const id = hitTest(at.point);
			hover(id);
			return id ? "pointer" : "";
		},
		leave() {
			hover(null);
			pointer?.(null);
		},
		exit() {
			hover(null);
			pointer?.(null);
		},
		click(at) {
			const id = vertexAt?.(at.point) ?? hitTest(at.point);
			if (!at.shiftKey || !toggle) select(id);
			// Shift+click on the empty map keeps the selection.
			else if (id) toggle(id);
		},
		press: (at) => drag?.(at) ?? null,
		key(event) {
			if (event.key !== "Escape") return false;
			select(null);
			return true;
		},
	};
}
