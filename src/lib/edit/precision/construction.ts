/**
 * Construction guides (C.5): lines the user places to draw against, as SketchUp's tape
 * measure does. Never in OSM: kept per building and level next to the floor plans. A guide is
 * an endless line, a `DirectionLine`; here is the geometry that places one.
 */
import type { Loc } from "#lib/osm/entity.ts";
import { fromLocal, local } from "#lib/osm/geometry.ts";
import { bearingOf } from "./frame.ts";
import type { DirectionLine } from "./snap.ts";

/** A guide kept for a level (and the building it was placed in, if any). */
export interface ConstructionGuide extends DirectionLine {
	readonly id: string;
	readonly level: number;
	/** The outline (building or level) it was placed in, as frames are kept. */
	readonly building?: string;
	/** Its colour on the map (`#rrggbb`); the default guide colour when unset. */
	readonly color?: string;
	/** Hidden by the user: kept, but neither drawn nor snapped to. */
	readonly hidden?: boolean;
}

/** The line parallel to side `a`–`b`, `offset` metres from it on the side of `toward`. */
export function parallelAt(
	a: Loc,
	b: Loc,
	offset: number,
	toward: Loc,
): DirectionLine {
	const [ex, ey] = local(a, b);
	const length = Math.hypot(ex, ey);
	const [px, py] = local(a, toward);
	// Left of a→b is (-ey, ex); the pointer's side by the sign of the cross product.
	const side = ex * py - ey * px >= 0 ? 1 : -1;
	const k = (side * offset) / length;
	return { origin: fromLocal(a, [-ey * k, ex * k]), angle: bearingOf(a, b) };
}

/** How far `p` is from the line through side `a`–`b`, in metres. */
export function offsetFrom(a: Loc, b: Loc, p: Loc): number {
	const [ex, ey] = local(a, b);
	const [px, py] = local(a, p);
	return Math.abs(ex * py - ey * px) / Math.hypot(ex, ey);
}

/** A guide's two ends when drawn: `reach` metres either side of its origin. */
export function guideEnds(
	{ origin, angle }: DirectionLine,
	reach: number,
): [Loc, Loc] {
	const dx = Math.cos((angle * Math.PI) / 180) * reach;
	const dy = Math.sin((angle * Math.PI) / 180) * reach;
	return [fromLocal(origin, [-dx, -dy]), fromLocal(origin, [dx, dy])];
}
