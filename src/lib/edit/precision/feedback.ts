/**
 * What precise drawing shows while the pointer moves (C.1): what it snapped to, with the
 * guides that explain it, and lengths and angles next to the pointer or along sides. Modes
 * hand it to `show`; the map draws the guides (`map/guide-layer.ts`) and the labels
 * (`ui/MeasureLabels.svelte`).
 */
import { type Message, msg } from "#lib/i18n/messages.ts";
import type { Loc } from "#lib/osm/entity.ts";
import { bearingOf, type Frame, lengthOf, normalizeAngle } from "./frame.ts";
import type { Guide, Inference, SnapTarget } from "./snap.ts";
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
	/** A scale factor (C.6). */
	readonly factor?: number;
	/** Show only the angle (a rotation) or the factor (a scaling), not a length. */
	readonly shows?: "angle" | "factor";
}

export interface Feedback {
	readonly snap: SnapTarget | null;
	readonly measures: readonly Measure[];
	/** What was typed, while something is (C.2). */
	readonly input?: TypedInput;
	/** Corners armed for tracking (C.4), marked on the map. */
	readonly armed?: readonly Loc[];
	/** Lines a tool draws besides the snap's guides: a measure, a guide being placed (C.5). */
	readonly lines?: readonly Guide[];
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

const INFERENCE_LABELS: Record<Inference, Message> = {
	extension: msg("inference_extension"),
	parallel: msg("inference_parallel"),
	perpendicular: msg("inference_perpendicular"),
	tracking: msg("inference_tracking"),
};

/**
 * What a snap means, in a word shown by the pointer (C.4): the inference it came from, or a
 * midpoint or crossing; none for a plain node, side or angle.
 */
export function inferenceLabel(target: SnapTarget | null): Message | undefined {
	if (!target) return undefined;
	const kind =
		"guides" in target ? target.guides?.find((g) => g.kind)?.kind : undefined;
	if (kind) return INFERENCE_LABELS[kind];
	if (target.kind === "guide") return msg("inference_guide");
	if (target.kind === "segment" && target.mark === "midpoint")
		return msg("inference_midpoint");
	if (
		(target.kind === "segment" && target.mark === "intersection") ||
		target.kind === "intersection"
	)
		return msg("inference_intersection");
	return undefined;
}
