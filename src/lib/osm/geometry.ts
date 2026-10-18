/**
 * Plane and sphere geometry on OSM data, in one place: closed ways, a way's positions, point in
 * polygon, extents, Web Mercator, midpoints and distances. Positions are [lon, lat].
 */
import type { Loc, Way } from "./entity.ts";
import type { Graph } from "./graph.ts";

/** A position, as a `Loc` or a GeoJSON `Position`. */
export type Point = readonly number[];

/** A way that ends where it starts (iD's `isClosed`). */
export function isClosed(way: Way): boolean {
	return way.nodes.length > 1 && way.nodes[0] === way.nodes.at(-1);
}

/** A closed way with at least three corners: one that can be drawn as a polygon. */
export function isClosedRing(way: Way): boolean {
	return way.nodes.length > 3 && isClosed(way);
}

/** The positions of a way's nodes, leaving out those not downloaded. */
export function wayLocs(graph: Graph, way: Way): Loc[] {
	return graph.childNodes(way).map((node) => node.loc);
}

/** Ray casting: whether a point is inside a ring (closed or not). */
export function pointInRing(point: Point, ring: readonly Point[]): boolean {
	const [x = 0, y = 0] = point;
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi = 0, yi = 0] = ring[i] ?? [];
		const [xj = 0, yj = 0] = ring[j] ?? [];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

/** Whether a point is inside a polygon: its outer ring, minus its holes. */
export function pointInPolygon(
	point: Point,
	polygon: readonly (readonly Point[])[],
): boolean {
	const [outer, ...holes] = polygon;
	return (
		outer !== undefined &&
		pointInRing(point, outer) &&
		!holes.some((hole) => pointInRing(point, hole))
	);
}

export interface Extent {
	readonly west: number;
	readonly south: number;
	readonly east: number;
	readonly north: number;
}

/** The smallest extent holding every point, or null for none. */
export function extentOf(points: Iterable<Point>): Extent | null {
	let west = Number.POSITIVE_INFINITY;
	let south = Number.POSITIVE_INFINITY;
	let east = Number.NEGATIVE_INFINITY;
	let north = Number.NEGATIVE_INFINITY;
	for (const [x = 0, y = 0] of points) {
		west = Math.min(west, x);
		south = Math.min(south, y);
		east = Math.max(east, x);
		north = Math.max(north, y);
	}
	return west <= east ? { west, south, east, north } : null;
}

/** Whether two extents overlap, or touch. */
export function extentsIntersect(a: Extent, b: Extent): boolean {
	return (
		a.west <= b.east &&
		b.west <= a.east &&
		a.south <= b.north &&
		b.south <= a.north
	);
}

/** The sphere of Web Mercator (EPSG:3857), in metres. */
export const EARTH_RADIUS = 6378137;

const RAD = Math.PI / 180;

/** Web Mercator metres of a position. */
export function toMercator([lon = 0, lat = 0]: Point): [number, number] {
	return [
		EARTH_RADIUS * lon * RAD,
		EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2)),
	];
}

/** The position at Web Mercator metres. */
export function fromMercator([x, y]: readonly [number, number]): [
	number,
	number,
] {
	return [
		x / EARTH_RADIUS / RAD,
		(2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) / RAD,
	];
}

/** Halfway between two positions as drawn on the map (in Web Mercator). */
export function midpoint(a: Point, b: Point): [number, number] {
	const [ax, ay] = toMercator(a);
	const [bx, by] = toMercator(b);
	return fromMercator([(ax + bx) / 2, (ay + by) / 2]);
}

/** The Earth's mean radius, for distances on the ground. */
const MEAN_RADIUS = 6_371_008.8;

/** Metres east and north of `origin`, flat around it (fine within a few hundred metres). */
function local(origin: Point, [lon = 0, lat = 0]: Point): [number, number] {
	const [lon0 = 0, lat0 = 0] = origin;
	return [
		(lon - lon0) * RAD * MEAN_RADIUS * Math.cos(lat0 * RAD),
		(lat - lat0) * RAD * MEAN_RADIUS,
	];
}

/** Metres from `point` to the nearest point of the segment `a`–`b`. */
export function distanceToSegment(point: Point, a: Point, b: Point): number {
	const [ax, ay] = local(point, a);
	const [bx, by] = local(point, b);
	const dx = bx - ax;
	const dy = by - ay;
	const length2 = dx * dx + dy * dy;
	const t = length2
		? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2))
		: 0;
	return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Metres from `point` to the nearest point of a line, or to a single point. */
export function distanceToLine(point: Point, line: readonly Point[]): number {
	const [only] = line;
	if (line.length === 1 && only) return distanceToSegment(point, only, only);
	let best = Number.POSITIVE_INFINITY;
	for (let i = 1; i < line.length; i++) {
		best = Math.min(
			best,
			distanceToSegment(point, line[i - 1] as Point, line[i] as Point),
		);
	}
	return best;
}
