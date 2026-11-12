/**
 * Browsing the map: a click selects the feature under it (or clears the selection), the
 * feature under the pointer is hovered and the cursor shows it can be selected, Escape clears
 * the selection; a Shift+click adds the feature to the selection or takes it out, a Shift+drag
 * draws a lasso. The edit overlay's vertices and midpoints come first: a click on a vertex
 * selects it, a press on one drags it (`drag`); a press on a selected feature moves the
 * selection whole (`move`). A click on empty floor may select it instead (`floor`, P5.4a).
 * In a building, Escape with nothing selected leaves it (`leave`, B.1).
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
	/** Moving the selection whole, pressed on a selected feature (after `drag`). */
	readonly move?: (at: MapPoint) => Drag | null;
	/** A lasso started by Shift+drag where nothing is dragged (P5.3.6). */
	readonly lasso?: (at: MapPoint) => Drag | null;
	/** Where the pointer is on the map (where a paste goes), null once it left. */
	readonly pointer?: (at: MapPoint | null) => void;
	/**
	 * Selects the unmapped floor at a click whose feature (`hit`, or null) is a level outline,
	 * a building or nothing; true when it did, and the click selects nothing else.
	 */
	readonly floor?: (at: MapPoint, hit: string | null) => boolean;
	/** Whether something is selected (features or the floor): Escape clears it first. */
	readonly hasSelection?: () => boolean;
	/** Leaves the building entered (B.1), on Escape with nothing selected; true when it did. */
	readonly leave?: () => boolean;
}

export function browseMode({
	hitTest,
	select,
	hover,
	drag,
	draggable,
	vertexAt,
	toggle,
	move,
	lasso,
	pointer,
	floor,
	hasSelection,
	leave,
}: BrowseOptions): Mode {
	function click(at: MapPoint) {
		const vertex = vertexAt?.(at.point) ?? null;
		const id = vertex ?? hitTest(at.point);
		if (!vertex && !at.shiftKey && floor?.(at, id)) return;
		if (!at.shiftKey || !toggle) select(id);
		// Shift+click on the empty map keeps the selection.
		else if (id) toggle(id);
	}

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
		click,
		press(at) {
			const taken = drag?.(at);
			if (taken) return taken;
			const drawn = at.shiftKey ? lasso?.(at) : move?.(at);
			if (!drawn) return null;
			// A press the mode takes has no click after it: released without moving, it is a
			// click (Escape after moving is not).
			let moved = false;
			return {
				...drawn,
				move(to) {
					moved = true;
					drawn.move(to);
				},
				cancel() {
					drawn.cancel();
					if (!moved) click(at);
				},
			};
		},
		key(event) {
			if (event.key !== "Escape") return false;
			if (leave && hasSelection && !hasSelection() && leave()) return true;
			select(null);
			return true;
		},
	};
}
