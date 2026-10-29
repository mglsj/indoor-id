/**
 * Split mode (P5.3.5): clicks draw a cut line, the pointer drags its last side along; a second
 * click on the last point, or Enter, finishes it and hands it to `onfinish`, which cuts the
 * rooms it crosses (`splitAreas`). Backspace takes the last point back, Escape stops without
 * cutting; leaving for another tool drops the line. Points snap as drawing does, onto corners and sides.
 */
import type { Loc } from "#lib/osm/entity.ts";
import type { MapPoint, Mode } from "../mode.ts";

export interface SplitOptions {
	/** Where a pointer position snaps to (a corner, a side), or null for nowhere. */
	readonly snap: (at: MapPoint) => Loc | null;
	/** The cut line as drawn so far, the pointer's position last. */
	readonly onchange: (cut: readonly Loc[]) => void;
	/** The finished cut line, or null when stopped. */
	readonly onfinish: (cut: readonly Loc[] | null) => void;
}

/** A click this close to the last point (in pixels) finishes the cut. */
const FINISH_PIXELS = 6;

export function splitMode({ snap, onchange, onfinish }: SplitOptions): Mode {
	const points: Loc[] = [];
	let last: { x: number; y: number } | null = null;
	let ended = false;
	const end = (cut: readonly Loc[] | null) => {
		if (ended) return;
		ended = true;
		onchange([]);
		onfinish(cut);
	};
	const finish = () => end(points.length >= 2 ? [...points] : null);
	return {
		name: "split",
		gestures: { doubleClickZoom: false },
		hover(at) {
			onchange([...points, snap(at) ?? at.lngLat]);
			return "crosshair";
		},
		leave: () => onchange([...points]),
		click(at) {
			if (
				last &&
				Math.hypot(at.point.x - last.x, at.point.y - last.y) <= FINISH_PIXELS
			) {
				finish();
				return;
			}
			points.push(snap(at) ?? at.lngLat);
			last = at.point;
			onchange([...points]);
		},
		key(event) {
			switch (event.key) {
				case "Enter":
					finish();
					return true;
				case "Escape":
					end(null);
					return true;
				case "Backspace":
				case "Delete":
					points.pop();
					last = null;
					onchange([...points]);
					return true;
				default:
					return false;
			}
		},
		exit() {
			// Left for another tool or mode: nothing is cut, and that tool stays on.
			if (ended) return;
			ended = true;
			onchange([]);
		},
	};
}
