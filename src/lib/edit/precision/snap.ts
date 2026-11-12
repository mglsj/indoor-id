/**
 * Where a pointer snaps on the map (P5.3, a pipeline since C.0). Every kind of snap gives
 * candidates, each scored by its distance from the pointer on screen plus a penalty for its
 * kind (after osm-simple3d-editor's `SNAP_PRIORITY`, ISC); the lowest score wins. The penalty
 * steps are larger than the reach of point snaps, so the order of kinds is strict: a node,
 * then a side's midpoint or where a direction line crosses a side or another line, then a
 * point on a side, then a floor plan's vertex, and only then a direction line alone (an angle
 * snap). The result says what won and carries the guides that explain it, for the map to draw.
 *
 * Candidates come from the feature store's indexes (`nodesNear`, `segmentsNear`) and
 * `FloorPlans.verticesNear` on the shown level; direction lines from `angleLines`. Distances
 * are measured on screen, through `project`; lines and crossings are worked out in metres on
 * the ground around each line's origin (`local`), where angles are true.
 */
import type { Segment } from "#lib/map/feature-store.ts";
import type { Loc, NodeId } from "#lib/osm/entity.ts";
import {
	type Extent,
	fromLocal,
	fromMercator,
	local,
	toMercator,
} from "#lib/osm/geometry.ts";
import type { Frame } from "./frame.ts";
import { nearestCrossing, nearestGridLines } from "./grid.ts";

/** Snapping distance of points (nodes, sides, plan vertices), in screen pixels. */
export const SNAP_PIXELS = 8;
/** How far from a direction line the pointer is still caught, in screen pixels… */
export const LINE_PIXELS = 10;
/** …and in degrees, seen from the line's origin. */
export const LINE_DEGREES = 5;
/** Score added per step of priority: more than any point snap's reach. */
const PRIORITY_STEP = 10;

/** A dashed line drawn to explain a snap, from where it starts to where it ends. */
export interface Guide {
	readonly from: Loc;
	readonly to: Loc;
}

/** A direction line through `origin`, `angle` degrees counterclockwise from east. */
export interface DirectionLine {
	readonly origin: Loc;
	readonly angle: number;
}

export type SnapTarget =
	| { readonly kind: "node"; readonly id: NodeId; readonly loc: Loc }
	/**
	 * A point on a side: where the pointer is nearest it, its midpoint (`mark`), or where a
	 * direction line crosses it (`mark`, with the line as a guide).
	 */
	| {
			readonly kind: "segment";
			readonly segment: Segment;
			readonly loc: Loc;
			readonly mark?: "midpoint" | "intersection";
			readonly guides?: readonly Guide[];
	  }
	| { readonly kind: "plan"; readonly loc: Loc }
	/** A crossing of the grid (C.3). */
	| { readonly kind: "grid"; readonly loc: Loc }
	/** On a direction line, nothing else there. */
	| {
			readonly kind: "angle";
			readonly loc: Loc;
			readonly guides: readonly Guide[];
	  }
	/** Where two direction lines cross. */
	| {
			readonly kind: "intersection";
			readonly loc: Loc;
			readonly guides: readonly Guide[];
	  }
	/** On the locked direction (Shift held while drawing). */
	| {
			readonly kind: "lock";
			readonly loc: Loc;
			readonly guides: readonly Guide[];
	  };

export interface SnapCandidates {
	readonly nodes?: readonly { readonly id: NodeId; readonly loc: Loc }[];
	readonly segments?: readonly Segment[];
	readonly planVertices?: readonly Loc[];
	/** Snap to sides' midpoints too. */
	readonly midpoints?: boolean;
	/** Direction lines (angle snapping), alone or where they cross sides and each other. */
	readonly lines?: readonly DirectionLine[];
	/**
	 * A locked direction: the result is always on it, at the foot of what the pointer snaps
	 * to otherwise (a node, a side…) or of the pointer itself.
	 */
	readonly lock?: DirectionLine;
	/** The grid shown, and the spacing drawn (C.3): its crossings, and its lines with angles. */
	readonly grid?: { readonly frame: Frame; readonly step: number };
}

type ScreenPoint = { readonly x: number; readonly y: number };

interface Scored {
	readonly target: SnapTarget;
	readonly score: number;
}

const PRIORITY = {
	node: 0,
	midpoint: 1,
	crossing: 1,
	segment: 2,
	plan: 3,
	grid: 3,
	angle: 4,
} as const;

/**
 * What `point` snaps to among `candidates`, or null when nothing is within reach. `pointer`:
 * where the pointer is on the ground, needed for direction lines (`unproject(point)`).
 */
export function snapAt(
	point: ScreenPoint,
	candidates: SnapCandidates,
	project: (loc: Loc) => ScreenPoint,
	distance = SNAP_PIXELS,
	pointer?: Loc,
): SnapTarget | null {
	const { lock } = candidates;
	if (lock) {
		const base = best(
			pointCandidates(point, pointer, candidates, project, distance),
		)?.target;
		const at = base?.loc ?? pointer;
		if (!at) return null;
		const foot = footOn(lock, at);
		return {
			kind: "lock",
			loc: foot,
			guides: [{ from: lock.origin, to: foot }],
		};
	}
	const scored = pointCandidates(point, pointer, candidates, project, distance);
	if (pointer && candidates.lines?.length) {
		scored.push(
			...lineCandidates(point, pointer, candidates, project, LINE_PIXELS),
		);
	}
	return best(scored)?.target ?? null;
}

function best(scored: readonly Scored[]): Scored | undefined {
	let winner: Scored | undefined;
	for (const s of scored) if (!winner || s.score < winner.score) winner = s;
	return winner;
}

/** Nodes, sides (and their midpoints), plan vertices within `distance` px. */
function pointCandidates(
	point: ScreenPoint,
	pointer: Loc | undefined,
	{
		nodes = [],
		segments = [],
		planVertices = [],
		midpoints,
		grid,
	}: SnapCandidates,
	project: (loc: Loc) => ScreenPoint,
	distance: number,
): Scored[] {
	const scored: Scored[] = [];
	const node = nearest(point, nodes, (n) => n.loc, project, distance);
	if (node) {
		scored.push({
			target: { kind: "node", id: node.item.id, loc: node.item.loc },
			score: node.distance + PRIORITY.node * PRIORITY_STEP,
		});
	}
	let side: Scored | undefined;
	for (const segment of segments) {
		const a = project(segment.a.loc);
		const b = project(segment.b.loc);
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const length2 = dx * dx + dy * dy;
		if (length2 === 0) continue;
		const t = Math.max(
			0,
			Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2),
		);
		const d = Math.hypot(a.x + t * dx - point.x, a.y + t * dy - point.y);
		const score = d + PRIORITY.segment * PRIORITY_STEP;
		if (d < distance && (!side || score < side.score)) {
			side = {
				target: { kind: "segment", segment, loc: along(segment, t) },
				score,
			};
		}
		if (midpoints) {
			const m = Math.hypot(
				(a.x + b.x) / 2 - point.x,
				(a.y + b.y) / 2 - point.y,
			);
			if (m < distance) {
				scored.push({
					target: {
						kind: "segment",
						segment,
						loc: along(segment, 0.5),
						mark: "midpoint",
					},
					score: m + PRIORITY.midpoint * PRIORITY_STEP,
				});
			}
		}
	}
	if (side) scored.push(side);
	const vertex = nearest(point, planVertices, (v) => v, project, distance);
	if (vertex) {
		scored.push({
			target: { kind: "plan", loc: vertex.item },
			score: vertex.distance + PRIORITY.plan * PRIORITY_STEP,
		});
	}
	if (grid && pointer) {
		const crossing = nearestCrossing(grid.frame, pointer, grid.step);
		const p = project(crossing);
		const d = Math.hypot(p.x - point.x, p.y - point.y);
		if (d < distance) {
			scored.push({
				target: { kind: "grid", loc: crossing },
				score: d + PRIORITY.grid * PRIORITY_STEP,
			});
		}
	}
	return scored;
}

/** Direction lines near the pointer, where they cross sides, and where two of them cross. */
function lineCandidates(
	point: ScreenPoint,
	pointer: Loc,
	{ lines = [], segments = [], grid }: SnapCandidates,
	project: (loc: Loc) => ScreenPoint,
	distance: number,
): Scored[] {
	const scored: Scored[] = [];
	const screenDistance = (loc: Loc) => {
		const p = project(loc);
		return Math.hypot(p.x - point.x, p.y - point.y);
	};
	const caught = lines.filter((line) => catches(line, pointer));
	for (const line of caught) {
		const foot = footOn(line, pointer);
		const d = screenDistance(foot);
		if (d >= distance) continue;
		scored.push({
			target: {
				kind: "angle",
				loc: foot,
				guides: [{ from: line.origin, to: foot }],
			},
			score: d + PRIORITY.angle * PRIORITY_STEP,
		});
		for (const segment of segments) {
			const crossing = crossSegment(line, segment);
			if (!crossing) continue;
			const dc = screenDistance(crossing);
			if (dc >= distance) continue;
			scored.push({
				target: {
					kind: "segment",
					segment,
					loc: crossing,
					mark: "intersection",
					guides: [{ from: line.origin, to: crossing }],
				},
				score: dc + PRIORITY.crossing * PRIORITY_STEP,
			});
		}
	}
	// Where a direction crosses the grid's nearest lines.
	if (grid) {
		const gridLines = nearestGridLines(grid.frame, pointer, grid.step);
		for (const line of caught) {
			for (const gridLine of gridLines) {
				const crossing = crossLines(line, gridLine);
				if (!crossing) continue;
				const dc = screenDistance(crossing);
				if (dc >= distance) continue;
				scored.push({
					target: {
						kind: "intersection",
						loc: crossing,
						guides: [{ from: line.origin, to: crossing }],
					},
					score: dc + PRIORITY.grid * PRIORITY_STEP,
				});
			}
		}
	}
	for (let i = 0; i < caught.length; i++) {
		for (let j = i + 1; j < caught.length; j++) {
			const a = caught[i] as DirectionLine;
			const b = caught[j] as DirectionLine;
			const crossing = crossLines(a, b);
			if (!crossing) continue;
			const dc = screenDistance(crossing);
			if (dc >= distance) continue;
			scored.push({
				target: {
					kind: "intersection",
					loc: crossing,
					guides: [
						{ from: a.origin, to: crossing },
						{ from: b.origin, to: crossing },
					],
				},
				score: dc + PRIORITY.crossing * PRIORITY_STEP,
			});
		}
	}
	return scored;
}

const RAD = Math.PI / 180;

function direction(line: DirectionLine): [number, number] {
	return [Math.cos(line.angle * RAD), Math.sin(line.angle * RAD)];
}

/** Whether the pointer is within `LINE_DEGREES` of the line, seen from its origin. */
function catches(line: DirectionLine, pointer: Loc): boolean {
	const [x, y] = local(line.origin, pointer);
	const length = Math.hypot(x, y);
	if (length === 0) return false;
	const [dx, dy] = direction(line);
	// The sine of the angle between them, either way along the line.
	return Math.abs(x * dy - y * dx) / length <= Math.sin(LINE_DEGREES * RAD);
}

/** The point of the line nearest `loc`. */
export function footOn(line: DirectionLine, loc: Loc): Loc {
	const [x, y] = local(line.origin, loc);
	const [dx, dy] = direction(line);
	const t = x * dx + y * dy;
	return fromLocal(line.origin, [t * dx, t * dy]);
}

/** Where the line crosses a side (ends included), or null. */
function crossSegment(line: DirectionLine, { a, b }: Segment): Loc | null {
	const [ax, ay] = local(line.origin, a.loc);
	const [bx, by] = local(line.origin, b.loc);
	const [dx, dy] = direction(line);
	const ex = bx - ax;
	const ey = by - ay;
	const denominator = dx * ey - dy * ex;
	if (Math.abs(denominator) < 1e-9) return null;
	// origin + t·d = a + s·e
	const s = (ax * dy - ay * dx) / denominator;
	if (s < 0 || s > 1) return null;
	return fromLocal(line.origin, [ax + s * ex, ay + s * ey]);
}

/** Where two lines cross, or null when they are parallel. */
function crossLines(a: DirectionLine, b: DirectionLine): Loc | null {
	const [ox, oy] = local(a.origin, b.origin);
	const [ax, ay] = direction(a);
	const [bx, by] = direction(b);
	const denominator = ax * by - ay * bx;
	if (Math.abs(denominator) < 1e-6) return null;
	const t = (ox * by - oy * bx) / denominator;
	return fromLocal(a.origin, [t * ax, t * ay]);
}

/** The extent on the ground of the square of `distance` px around `point` (the map may turn). */
export function areaAround(
	point: ScreenPoint,
	unproject: (point: ScreenPoint) => Loc,
	distance = SNAP_PIXELS,
): Extent {
	const corners = [
		[-distance, -distance],
		[distance, -distance],
		[distance, distance],
		[-distance, distance],
	].map(([dx = 0, dy = 0]) => unproject({ x: point.x + dx, y: point.y + dy }));
	return {
		west: Math.min(...corners.map((c) => c[0])),
		south: Math.min(...corners.map((c) => c[1])),
		east: Math.max(...corners.map((c) => c[0])),
		north: Math.max(...corners.map((c) => c[1])),
	};
}

/** The candidate nearest `point` on screen, within `distance` px. */
function nearest<T>(
	point: ScreenPoint,
	candidates: readonly T[],
	locOf: (candidate: T) => Loc,
	project: (loc: Loc) => ScreenPoint,
	distance: number,
): { item: T; distance: number } | undefined {
	let best: { item: T; distance: number } | undefined;
	for (const candidate of candidates) {
		const screen = project(locOf(candidate));
		const d = Math.hypot(screen.x - point.x, screen.y - point.y);
		if (d < (best?.distance ?? distance))
			best = { item: candidate, distance: d };
	}
	return best;
}

/** The position a fraction `t` of the way along a side, as drawn (in Web Mercator). */
function along({ a, b }: Segment, t: number): Loc {
	const [ax, ay] = toMercator(a.loc);
	const [bx, by] = toMercator(b.loc);
	return fromMercator([ax + t * (bx - ax), ay + t * (by - ay)]);
}
