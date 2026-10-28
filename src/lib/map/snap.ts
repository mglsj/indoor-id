/**
 * Where a pointer snaps on the map, within 8 px: onto a node first, else onto a side of a
 * way, else onto a floor plan's vertex (P5.3). Candidates come from the feature store's indexes
 * (`nodesNear`, `segmentsNear`) and `FloorPlans.verticesNear`, on the shown level; distances
 * are measured on screen, through `project`.
 */
import type { Loc, NodeId } from "#lib/osm/entity.ts";
import { type Extent, fromMercator, toMercator } from "#lib/osm/geometry.ts";
import type { Segment } from "./feature-store.ts";

/** Snapping distance, in screen pixels. */
export const SNAP_PIXELS = 8;

export type SnapTarget =
	| { readonly kind: "node"; readonly id: NodeId; readonly loc: Loc }
	/** A point on a side, the position where the pointer is nearest it. */
	| { readonly kind: "segment"; readonly segment: Segment; readonly loc: Loc }
	| { readonly kind: "plan"; readonly loc: Loc };

export interface SnapCandidates {
	readonly nodes?: readonly { readonly id: NodeId; readonly loc: Loc }[];
	readonly segments?: readonly Segment[];
	readonly planVertices?: readonly Loc[];
}

type ScreenPoint = { readonly x: number; readonly y: number };

/** What `point` snaps to among `candidates`, or null when nothing is within `distance` px. */
export function snapAt(
	point: ScreenPoint,
	{ nodes = [], segments = [], planVertices = [] }: SnapCandidates,
	project: (loc: Loc) => ScreenPoint,
	distance = SNAP_PIXELS,
): SnapTarget | null {
	const node = nearest(point, nodes, (n) => n.loc, project, distance);
	if (node) return { kind: "node", id: node.id, loc: node.loc };

	let best: SnapTarget | null = null;
	let bestDistance = distance;
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
		if (d < bestDistance) {
			bestDistance = d;
			best = { kind: "segment", segment, loc: along(segment, t) };
		}
	}
	if (best) return best;

	const vertex = nearest(point, planVertices, (v) => v, project, distance);
	return vertex ? { kind: "plan", loc: vertex } : null;
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
): T | undefined {
	let best: T | undefined;
	let bestDistance = distance;
	for (const candidate of candidates) {
		const screen = project(locOf(candidate));
		const d = Math.hypot(screen.x - point.x, screen.y - point.y);
		if (d < bestDistance) {
			bestDistance = d;
			best = candidate;
		}
	}
	return best;
}

/** The position a fraction `t` of the way along a side, as drawn (in Web Mercator). */
function along({ a, b }: Segment, t: number): Loc {
	const [ax, ay] = toMercator(a.loc);
	const [bx, by] = toMercator(b.loc);
	return fromMercator([ax + t * (bx - ax), ay + t * (by - ay)]);
}
