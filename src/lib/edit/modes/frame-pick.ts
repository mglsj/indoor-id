/**
 * Setting the drawing frame on the map (C.3): a click on a side turns the frame to it
 * ("Align to a side"), or a click on a spot (snapped) moves its origin there. Escape, or
 * a click on nothing usable, gives up.
 */

import type { Loc } from "#lib/osm/entity.ts";
import type { MapPoint, Mode } from "../mode.ts";
import { bearingOf, foldAngle } from "../precision/frame.ts";
import type { SnapTarget } from "../precision/snap.ts";

export type FramePick = "align" | "origin";

export interface FramePickOptions {
	readonly pick: FramePick;
	readonly snap: (at: MapPoint) => SnapTarget | null;
	readonly onangle: (angle: number) => void;
	readonly onorigin: (origin: Loc) => void;
	readonly ondone: () => void;
}

export function framePickMode({
	pick,
	snap,
	onangle,
	onorigin,
	ondone,
}: FramePickOptions): Mode {
	return {
		name: `frame-${pick}`,
		hover: (at) =>
			pick === "align" && snap(at)?.kind !== "segment"
				? "not-allowed"
				: "crosshair",
		click(at) {
			const target = snap(at);
			if (pick === "origin") {
				onorigin(target?.loc ?? at.lngLat);
			} else if (target?.kind === "segment") {
				const { a, b } = target.segment;
				onangle(foldAngle(bearingOf(a.loc, b.loc)));
			}
			ondone();
		},
		key(event) {
			if (event.key !== "Escape") return false;
			ondone();
			return true;
		},
		finish: ondone,
	};
}
