/**
 * Editing modes, after iD's: the mode in force decides what a click, a drag or a key does on
 * the map, and what the cursor shows. `ModeManager` hands each map event to it.
 */
import type { LngLat } from "#lib/floorplans/georef.ts";

/** A pointer position on the map, with the modifier keys held. */
export interface MapPoint {
	/** Screen pixels from the map's top-left corner. */
	readonly point: { readonly x: number; readonly y: number };
	readonly lngLat: LngLat;
	readonly shiftKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
}

/** A drag a mode took from a press: moves once the pointer has moved 3 px. */
export interface Drag {
	/** Cursor while dragging. */
	readonly cursor?: string;
	/** The pointer moved (at most once per frame). */
	move(at: MapPoint): void;
	/** Released after moving: the drag is done. */
	end(at: MapPoint): void;
	/** Released without moving, or Escape: nothing should have changed. */
	cancel(): void;
}

/** MapLibre's own gestures a mode keeps (all on unless turned off). */
export interface MapGestures {
	readonly doubleClickZoom?: boolean;
	readonly boxZoom?: boolean;
	readonly dragRotate?: boolean;
}

export interface Mode {
	/** For tests and debugging: "browse", "floorplan"… */
	readonly name: string;
	readonly gestures?: MapGestures;
	enter?(): void;
	exit?(): void;
	/** The cursor over this point (none: the map's own). */
	hover?(at: MapPoint): string;
	/** A click (a press and release without dragging). */
	click?(at: MapPoint): void;
	/** A press: a drag to take it (the map then stays still), or null to let the map pan. */
	press?(at: MapPoint): Drag | null;
	/** The pointer left the map. */
	leave?(): void;
	/** A key pressed while the map's shortcuts apply; true when handled. */
	key?(event: KeyboardEvent): boolean;
	/** Ends the mode's work as Escape would, from outside (the shown level changed). */
	finish?(): void;
}
