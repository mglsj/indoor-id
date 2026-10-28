/**
 * Browsing the map: a click selects the feature under it (or clears the selection), the
 * feature under the pointer is hovered and the cursor shows it can be selected, Escape clears
 * the selection. The edit overlay's vertices and midpoints come first: a click on a vertex
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
}

export function browseMode({
	hitTest,
	select,
	hover,
	drag,
	draggable,
	vertexAt,
}: BrowseOptions): Mode {
	return {
		name: "browse",
		hover(at) {
			// Over a vertex the way stays hovered: its vertices stay shown.
			if (draggable?.(at.point)) return "move";
			const id = hitTest(at.point);
			hover(id);
			return id ? "pointer" : "";
		},
		leave: () => hover(null),
		exit: () => hover(null),
		click: (at) => select(vertexAt?.(at.point) ?? hitTest(at.point)),
		press: (at) => drag?.(at) ?? null,
		key(event) {
			if (event.key !== "Escape") return false;
			select(null);
			return true;
		},
	};
}
