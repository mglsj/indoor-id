/**
 * The grid (C.3): lines along the drawing frame's axes every `minor` metres, stronger every
 * `major`, from the frame's origin. Lines closer than 8 px on screen are left out, so zooming
 * out never draws a carpet; snapping uses the finest spacing still drawn.
 */
import type { Loc } from "#lib/osm/entity.ts";
import { type Frame, fromFrame, toFrame } from "./frame.ts";

export interface GridSpacing {
	/** Metres between minor lines. */
	readonly minor: number;
	/** Metres between major lines (a multiple of minor). */
	readonly major: number;
}

/** Lines closer than this on screen aren't drawn. */
export const GRID_MIN_PIXELS = 8;

/** The finest spacing drawn at `pixelsPerMetre`, or null when even major lines are too close. */
export function drawnSpacing(
	{ minor, major }: GridSpacing,
	pixelsPerMetre: number,
): number | null {
	if (minor * pixelsPerMetre >= GRID_MIN_PIXELS) return minor;
	if (major * pixelsPerMetre >= GRID_MIN_PIXELS) return major;
	return null;
}

export interface GridLine {
	readonly from: Loc;
	readonly to: Loc;
	readonly major: boolean;
}

/**
 * The grid's lines across the area whose corners are `view` (the map may turn), at most
 * `max` of them; none when lines would be closer than 8 px.
 */
export function gridLines(
	frame: Frame,
	view: readonly Loc[],
	spacing: GridSpacing,
	pixelsPerMetre: number,
	max = 600,
): GridLine[] {
	const step = drawnSpacing(spacing, pixelsPerMetre);
	if (!step || view.length === 0) return [];
	const xs = view.map((loc) => toFrame(frame, loc));
	const minX = Math.min(...xs.map((p) => p[0]));
	const maxX = Math.max(...xs.map((p) => p[0]));
	const minY = Math.min(...xs.map((p) => p[1]));
	const maxY = Math.max(...xs.map((p) => p[1]));
	const first = (min: number) => Math.ceil(min / step);
	const last = (max: number) => Math.floor(max / step);
	const count = last(maxX) - first(minX) + 1 + (last(maxY) - first(minY) + 1);
	if (count > max) return [];
	const isMajor = (k: number) =>
		step === spacing.major ||
		Math.abs(
			(k * step) / spacing.major - Math.round((k * step) / spacing.major),
		) < 1e-6;
	const lines: GridLine[] = [];
	for (let k = first(minX); k <= last(maxX); k++) {
		lines.push({
			from: fromFrame(frame, [k * step, minY]),
			to: fromFrame(frame, [k * step, maxY]),
			major: isMajor(k),
		});
	}
	for (let k = first(minY); k <= last(maxY); k++) {
		lines.push({
			from: fromFrame(frame, [minX, k * step]),
			to: fromFrame(frame, [maxX, k * step]),
			major: isMajor(k),
		});
	}
	return lines;
}

/** The grid crossing nearest `loc`. */
export function nearestCrossing(frame: Frame, loc: Loc, step: number): Loc {
	const [x, y] = toFrame(frame, loc);
	return fromFrame(frame, [
		Math.round(x / step) * step,
		Math.round(y / step) * step,
	]);
}

/** The grid lines nearest `loc`, one along each axis, as lines through a point at an angle. */
export function nearestGridLines(
	frame: Frame,
	loc: Loc,
	step: number,
): { origin: Loc; angle: number }[] {
	const [x, y] = toFrame(frame, loc);
	const gx = Math.round(x / step) * step;
	const gy = Math.round(y / step) * step;
	return [
		{ origin: fromFrame(frame, [gx, y]), angle: frame.angle + 90 },
		{ origin: fromFrame(frame, [x, gy]), angle: frame.angle },
	];
}
