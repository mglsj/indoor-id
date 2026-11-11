/**
 * What precise drawing shows while the pointer moves (C.1): what it snapped to, with the
 * guides that explain it, and lengths and angles next to the pointer or along sides. Modes
 * hand it to `show`; the map draws the guides (`map/guide-layer.ts`) and the labels
 * (`ui/MeasureLabels.svelte`).
 */
import type { Loc } from "#lib/osm/entity.ts";
import { bearingOf, type Frame, lengthOf, normalizeAngle } from "./frame.ts";
import type { SnapTarget } from "./snap.ts";
import type { TypedInput } from "./typed.ts";

/** A length (and an angle) shown on the map. */
export interface Measure {
	/** Where: the pointer, or the middle of a side. */
	readonly at: Loc;
	/** Shown next to the pointer rather than on a side. */
	readonly pointer?: boolean;
	/** Metres. */
	readonly length: number;
	/** A rectangle's depth in metres, shown as `length × depth`. */
	readonly depth?: number;
	/** Degrees, 0 to 360 against the frame, or 0 to 180 between two sides. */
	readonly angle?: number;
}

export interface Feedback {
	readonly snap: SnapTarget | null;
	readonly measures: readonly Measure[];
	/** What was typed, while something is (C.2). */
	readonly input?: TypedInput;
}

/** Shows feedback, or hides it (null). */
export type ShowFeedback = (feedback: Feedback | null) => void;

/**
 * The side being drawn from `from` to `to`: its length and its angle, at the corner with the
 * side before it (`previous` to `from`) when there is one, else against the frame's x axis.
 */
export function sideMeasure(
	from: Loc,
	to: Loc,
	frame: Frame,
	previous?: Loc,
): Measure {
	const bearing = bearingOf(from, to);
	const angle = previous
		? Math.abs(normalizeAngle(bearing - bearingOf(from, previous)))
		: (((bearing - frame.angle) % 360) + 360) % 360;
	return { at: to, pointer: true, length: lengthOf(from, to), angle };
}
