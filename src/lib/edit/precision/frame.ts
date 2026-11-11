/**
 * The drawing frame (C.0): an origin and a rotation that the grid, axis locks and angles are
 * measured in, as CAD's user coordinate system or SketchUp's axes. Positions in a frame are
 * metres along its x axis (`angle` degrees counterclockwise from east) and its y axis (90°
 * further), flat around the origin (`local` in `osm/geometry.ts`): fine across a building.
 * Web Mercator is conformal, so angles measured here are the angles drawn on the map.
 */
import type { Loc } from "#lib/osm/entity.ts";
import { fromLocal, local, type Point } from "#lib/osm/geometry.ts";

export interface Frame {
	readonly origin: Loc;
	/** Degrees counterclockwise from east, in [-45, 45) for a building's frame. */
	readonly angle: number;
}

/** A frame at `origin` with its axes east and north. */
export function northFrame(origin: Loc): Frame {
	return { origin, angle: 0 };
}

const RAD = Math.PI / 180;

/** Metres along the frame's x and y axes from its origin. */
export function toFrame(frame: Frame, loc: Point): [number, number] {
	const [east, north] = local(frame.origin, loc);
	const c = Math.cos(frame.angle * RAD);
	const s = Math.sin(frame.angle * RAD);
	return [east * c + north * s, -east * s + north * c];
}

/** The position `x`, `y` metres along the frame's axes from its origin. */
export function fromFrame(
	frame: Frame,
	[x, y]: readonly [number, number],
): Loc {
	const c = Math.cos(frame.angle * RAD);
	const s = Math.sin(frame.angle * RAD);
	return fromLocal(frame.origin, [x * c - y * s, x * s + y * c]);
}

/** An angle in degrees, brought into [-180, 180). */
export function normalizeAngle(degrees: number): number {
	return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/** The direction from `a` to `b` on the ground, in degrees counterclockwise from east. */
export function bearingOf(a: Point, b: Point): number {
	const [x, y] = local(a, b);
	return Math.atan2(y, x) / RAD;
}

/** Metres between two positions, flat around the first (within a building). */
export function lengthOf(a: Point, b: Point): number {
	const [x, y] = local(a, b);
	return Math.hypot(x, y);
}

/**
 * The frame of an outline (a building or a level): its main direction, the directions of its
 * sides averaged modulo 90° and weighted by their lengths, and its origin at the south-west
 * corner of the box around it in that frame. After osm-simple3d-editor's `local-axes.ts`
 * (ISC). Null for fewer than two distinct corners.
 */
export function outlineFrame(ring: readonly Loc[]): Frame | null {
	const [first] = ring;
	if (!first) return null;
	// Summing each side's direction ×4 folds the four directions of a right angle into one.
	let sx = 0;
	let sy = 0;
	for (let i = 1; i < ring.length; i++) {
		const [x, y] = local(first, ring[i] as Loc);
		const [px, py] = local(first, ring[i - 1] as Loc);
		const dx = x - px;
		const dy = y - py;
		const length = Math.hypot(dx, dy);
		if (length === 0) continue;
		const angle = Math.atan2(dy, dx) * 4;
		sx += length * Math.cos(angle);
		sy += length * Math.sin(angle);
	}
	if (sx === 0 && sy === 0) return null;
	const angle = Math.atan2(sy, sx) / 4 / RAD;
	const turned: Frame = { origin: first, angle: roundAngle(angle) };
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	for (const loc of ring) {
		const [x, y] = toFrame(turned, loc);
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
	}
	return { origin: fromFrame(turned, [minX, minY]), angle: turned.angle };
}

/** An angle kept to a millionth of a degree, so a square building's frame reads 0, not 1e-15. */
function roundAngle(angle: number): number {
	const rounded = Math.round(angle * 1e6) / 1e6;
	return rounded === 45 ? -45 : rounded + 0;
}
