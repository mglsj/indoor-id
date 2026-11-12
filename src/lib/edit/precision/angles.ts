/**
 * Angle snapping (C.1): the direction lines a new side may snap to, from the corner it starts
 * at. Every `step` degrees from the frame's axes and from the previous side (90° turns them
 * into CAD's Ortho), and, from the drawing's first corner, along its first side and square to
 * it, so the last corners of a rectangle fall where its first side says.
 */
import type { Loc } from "#lib/osm/entity.ts";
import { bearingOf, type Frame } from "./frame.ts";
import type { DirectionLine } from "./snap.ts";

export interface AngleSource {
	/** The corner the new side starts from. */
	readonly from: Loc;
	/** The corner before it, when there is one: angles are measured from that side too. */
	readonly previous?: Loc;
	/** The drawing's first two corners, once there are three or more corners. */
	readonly firstSide?: readonly [Loc, Loc];
	readonly frame: Frame;
	/** Degrees between snapped directions (15, 45, 90…). */
	readonly step: number;
}

export function angleLines({
	from,
	previous,
	firstSide,
	frame,
	step,
}: AngleSource): DirectionLine[] {
	const lines: DirectionLine[] = [];
	const seen: number[] = [];
	const add = (origin: Loc, angle: number, set: number[]) => {
		// A line covers both directions: keep one per angle modulo 180°.
		const folded = ((angle % 180) + 180) % 180;
		if (
			set.some(
				(a) => Math.abs(a - folded) < 1e-6 || Math.abs(a - folded) > 180 - 1e-6,
			)
		)
			return;
		set.push(folded);
		lines.push({ origin, angle: folded });
	};
	const fan = (base: number) => {
		for (let k = 0; k * step < 180; k++) add(from, base + k * step, seen);
	};
	fan(frame.angle);
	if (previous) fan(bearingOf(previous, from));
	if (firstSide) {
		const [a, b] = firstSide;
		const firstSeen: number[] = [];
		const along = bearingOf(a, b);
		add(a, along, firstSeen);
		add(a, along + 90, firstSeen);
	}
	return lines;
}
