/**
 * Boolean operations on polygons, through Clipper2 (one clipping library for the app, R5):
 * Clipper works on integers, so coordinates are scaled from the subject's first point; the
 * corners given come back exactly as given, the others (where sides cross) to `1 / scale`.
 * Pure.
 */
import {
	booleanOpWithPolyTree,
	ClipType,
	FillRule,
	isPositive,
	type Path64,
	type PolyPath64,
	PolyTree64,
} from "clipper2-ts";
import type { Loc } from "./entity.ts";

/** A polygon: its outer ring, then its holes, each ring closed. */
export type Polygon = readonly (readonly Loc[])[];

/**
 * `subject` minus, or within, every polygon of `clips` (overlapping clips count once). Outer
 * rings come back counter-clockwise and holes clockwise, closed; an island in a hole is a
 * polygon of its own.
 */
export function clipPolygons(
	operation: "difference" | "intersection",
	subject: readonly Polygon[],
	clips: readonly Polygon[],
	scale: number,
): Loc[][][] {
	const origin = subject[0]?.[0]?.[0];
	if (!origin) return [];
	const [ox, oy] = origin;
	const given = new Map<string, Loc>();
	const toPath = (ring: readonly Loc[], outer: boolean): Path64 => {
		const path = ring.slice(0, -1).map((loc) => {
			const point = {
				x: Math.round((loc[0] - ox) * scale),
				y: Math.round((loc[1] - oy) * scale),
			};
			given.set(`${point.x},${point.y}`, loc);
			return point;
		});
		// Outer rings one way, holes the other: overlapping polygons then add up (non-zero).
		return isPositive(path) === outer ? path : path.reverse();
	};
	const paths = (polygons: readonly Polygon[]) =>
		polygons.flatMap((polygon) =>
			polygon.map((ring, i) => toPath(ring, i === 0)),
		);
	const tree = new PolyTree64();
	booleanOpWithPolyTree(
		operation === "difference" ? ClipType.Difference : ClipType.Intersection,
		paths(subject),
		paths(clips),
		tree,
		FillRule.NonZero,
	);

	const toRing = (path: Path64, outer: boolean): Loc[] => {
		const oriented = isPositive(path) === outer ? path : [...path].reverse();
		const ring = oriented.map(
			(p): Loc =>
				given.get(`${p.x},${p.y}`) ?? [p.x / scale + ox, p.y / scale + oy],
		);
		const first = ring[0];
		return first ? [...ring, first] : ring;
	};
	const polygons: Loc[][][] = [];
	const visit = (node: PolyPath64): void => {
		for (let i = 0; i < node.count; i++) {
			const outer = node.child(i);
			if (!outer.polygon) continue;
			const holes: PolyPath64[] = [];
			for (let j = 0; j < outer.count; j++) holes.push(outer.child(j));
			polygons.push([
				toRing(outer.polygon, true),
				...holes.flatMap((h) => (h.polygon ? [toRing(h.polygon, false)] : [])),
			]);
			for (const hole of holes) visit(hole);
		}
	};
	visit(tree);
	return polygons;
}
