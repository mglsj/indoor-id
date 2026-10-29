/**
 * Square the corners of an area (P5.3.5), after iD's `actionOrthogonalize`: corners within 13°
 * of a right angle are moved, a little each round along their bisector, until every one is
 * square; nodes on a straight run between corners (within 13° of straight) are put back on the
 * line between them. Worked out in Web Mercator, as drawn. Refused when a corner is neither
 * nearly square nor nearly straight (not a squarish shape), or when it is square already.
 */
import type { NodeId, WayId } from "#lib/osm/entity.ts";
import { fromMercator, isClosed, toMercator } from "#lib/osm/geometry.ts";
import { type Graph, getEntity } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";

export type SquareRefusal = "not_area" | "not_squarish" | "square_enough";

type Vec = [number, number];

const THRESHOLD = (13 * Math.PI) / 180;
/** |cos| below this: a corner nearly square. */
const LOWER = Math.cos(Math.PI / 2 - THRESHOLD);
/** cos below minus this: a node nearly straight. */
const UPPER = Math.cos(THRESHOLD);
/** A corner within about 0.1° of square counts as square. */
const SQUARE = Math.cos(Math.PI / 2 - (0.1 * Math.PI) / 180);
const ROUNDS = 1000;

export function orthogonalizeRefusal(
	graph: Graph,
	id: WayId,
): SquareRefusal | null {
	const way = graph.entity(id);
	if (way?.type !== "way" || !isClosed(way) || way.nodes.length < 4)
		return "not_area";
	const shape = shapeOf(graph, way.nodes);
	if (!shape) return "not_squarish";
	return shape.corners.every((i) => Math.abs(cosAt(shape.points, i)) < SQUARE)
		? "square_enough"
		: null;
}

/**
 * iD's `unsquare_way` check: a closed way whose corners are all within `degrees` of square (or
 * of straight), some of them not square. Such a shape was meant to be square.
 */
export function isUnsquare(graph: Graph, id: WayId, degrees = 5): boolean {
	const way = graph.entity(id);
	if (way?.type !== "way" || !isClosed(way) || way.nodes.length < 5)
		return false;
	const nodes = way.nodes.slice(0, -1);
	const points = nodes.map((n) => graph.entity(n));
	if (points.some((n) => n?.type !== "node")) return false;
	const ring = points.map((n) =>
		toMercator((n as { loc: readonly number[] }).loc),
	);
	const nearSquare = Math.cos(Math.PI / 2 - (degrees * Math.PI) / 180);
	const nearStraight = Math.cos((degrees * Math.PI) / 180);
	let corners = 0;
	let unsquare = false;
	for (let i = 0; i < ring.length; i++) {
		const c = cosAt(ring, i);
		if (Math.abs(c) < nearSquare) {
			corners++;
			if (Math.abs(c) >= SQUARE) unsquare = true;
		} else if (c > -nearStraight) {
			return false;
		}
	}
	return corners >= 3 && unsquare;
}

export function orthogonalize(id: WayId): Action {
	return (graph: Graph) => {
		const way = getEntity(graph, id, "way");
		const shape = shapeOf(graph, way.nodes);
		if (!shape) return graph;
		const { ring, corners } = shape;
		// The corners alone, squared round after round.
		let poly = corners.map((i) => shape.points[i] as Vec);
		for (let round = 0; round < ROUNDS; round++) {
			const moves = poly.map((point, i) => motion(poly, i, point));
			poly = poly.map(([x, y], i) => {
				const [dx, dy] = moves[i] as Vec;
				return [x + dx, y + dy];
			});
			const worst = Math.max(...poly.map((_, i) => Math.abs(cosAt(poly, i))));
			if (worst < 1e-6) break;
		}
		const placed = new Map<number, Vec>();
		corners.forEach((index, k) => {
			placed.set(index, poly[k] as Vec);
		});
		// Straight nodes back on the line between the corners around them.
		const n = ring.length;
		for (let i = 0; i < n; i++) {
			if (placed.has(i)) continue;
			let before = (i - 1 + n) % n;
			while (!corners.includes(before)) before = (before - 1 + n) % n;
			let after = (i + 1) % n;
			while (!corners.includes(after)) after = (after + 1) % n;
			placed.set(
				i,
				project(
					shape.points[i] as Vec,
					placed.get(before) as Vec,
					placed.get(after) as Vec,
				),
			);
		}
		let g = graph;
		ring.forEach((nodeId, i) => {
			const node = getEntity(g, nodeId, "node");
			g = g.replace({ ...node, loc: fromMercator(placed.get(i) as Vec) });
		});
		return g;
	};
}

/** A closed way's nodes once each, their Mercator points, and which are corners. */
function shapeOf(
	graph: Graph,
	nodes: readonly NodeId[],
): { ring: NodeId[]; points: Vec[]; corners: number[] } | null {
	const ring = nodes.slice(0, -1);
	const points = ring.map((id) => toMercator(getEntity(graph, id, "node").loc));
	const corners: number[] = [];
	for (let i = 0; i < points.length; i++) {
		const c = cosAt(points, i);
		if (Math.abs(c) < LOWER) corners.push(i);
		else if (c > -UPPER) return null;
	}
	return corners.length >= 3 ? { ring, points, corners } : null;
}

/** The cosine of the angle at point `i` of a closed ring. */
function cosAt(points: readonly Vec[], i: number): number {
	const n = points.length;
	const point = points[i] as Vec;
	const p = unit(sub(points[(i - 1 + n) % n] as Vec, point));
	const q = unit(sub(points[(i + 1) % n] as Vec, point));
	return p[0] * q[0] + p[1] * q[1];
}

/** iD's move of one corner: along its bisector, by how far it is from square. */
function motion(poly: readonly Vec[], i: number, point: Vec): Vec {
	const n = poly.length;
	const a = sub(poly[(i - 1 + n) % n] as Vec, point);
	const c = sub(poly[(i + 1) % n] as Vec, point);
	const scale = 2 * Math.min(length(a), length(c));
	const p = unit(a);
	const q = unit(c);
	const dot = p[0] * q[0] + p[1] * q[1];
	const bisector = unit([p[0] + q[0], p[1] + q[1]]);
	const step = 0.1 * dot * scale;
	return [bisector[0] * step, bisector[1] * step];
}

function project(point: Vec, a: Vec, b: Vec): Vec {
	const d = sub(b, a);
	const l2 = d[0] * d[0] + d[1] * d[1];
	if (l2 === 0) return a;
	const t = ((point[0] - a[0]) * d[0] + (point[1] - a[1]) * d[1]) / l2;
	return [a[0] + t * d[0], a[1] + t * d[1]];
}

function sub(a: Vec, b: Vec): Vec {
	return [a[0] - b[0], a[1] - b[1]];
}

function length([x, y]: Vec): number {
	return Math.hypot(x, y);
}

function unit(v: Vec): Vec {
	const l = length(v);
	return l === 0 ? [0, 0] : [v[0] / l, v[1] / l];
}
