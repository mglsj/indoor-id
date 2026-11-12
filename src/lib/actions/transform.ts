/**
 * Precise edits of existing geometry (C.6), in metres on the ground: moving, turning and
 * scaling nodes by typed values, setting a side's length, moving a side while its neighbours
 * keep their directions (JOSM's extrude, "move" variant), a parallel copy of a way (offset),
 * and squaring a way to the drawing frame's axes. Positions are worked out around a local
 * origin (`local`/`fromLocal`), where angles and lengths are true.
 */
import type { Loc, NodeId, WayId } from "#lib/osm/entity.ts";
import { fromLocal, local } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";

type Vec = [number, number];

/** Moves nodes from where they are by `[east, north]` metres. */
export function translateNodes(
	nodes: ReadonlySet<NodeId>,
	[east, north]: readonly [number, number],
): Action {
	return (graph) =>
		mapNodes(graph, nodes, (loc) => fromLocal(loc, [east, north]));
}

/** Turns nodes `degrees` counterclockwise about `centre`. */
export function rotateNodes(
	nodes: ReadonlySet<NodeId>,
	centre: Loc,
	degrees: number,
): Action {
	const r = (degrees * Math.PI) / 180;
	const [c, s] = [Math.cos(r), Math.sin(r)];
	return (graph) =>
		mapNodes(graph, nodes, (loc) => {
			const [x, y] = local(centre, loc);
			return fromLocal(centre, [x * c - y * s, x * s + y * c]);
		});
}

/** Scales nodes by `factor` from the fixed point `centre`. */
export function scaleNodes(
	nodes: ReadonlySet<NodeId>,
	centre: Loc,
	factor: number,
): Action {
	return (graph) =>
		mapNodes(graph, nodes, (loc) => {
			const [x, y] = local(centre, loc);
			return fromLocal(centre, [x * factor, y * factor]);
		});
}

/**
 * Sets the length of side `index` of a way (from its node `index` to the next), moving the
 * side's second end along the side.
 */
export function setSideLength(
	way: WayId,
	index: number,
	metres: number,
): Action {
	return (graph) => {
		const ring = ringOf(graph, way);
		const a = ring.at(index);
		const b = ring.at((index + 1) % ring.length);
		if (!a || !b) return graph;
		const [x, y] = local(a.loc, b.loc);
		const length = Math.hypot(x, y);
		if (length === 0) return graph;
		const k = metres / length;
		return graph.replace({ ...b, loc: fromLocal(a.loc, [x * k, y * k]) });
	};
}

/**
 * Moves side `index` of a way `distance` metres square to itself (positive: to the left of the
 * way's direction), its neighbouring sides keeping their directions: each end slides along its
 * neighbour. An end without a neighbour, or with one in line, moves square to the side.
 */
export function moveSide(way: WayId, index: number, distance: number): Action {
	return (graph) => {
		const entity = graph.entity(way);
		if (entity?.type !== "way") return graph;
		const closed = isClosed(entity.nodes);
		const ring = ringOf(graph, way);
		const n = ring.length;
		const a = ring[index];
		const b = ring[(index + 1) % n];
		if (!a || !b) return graph;
		const origin = a.loc;
		const pa = local(origin, a.loc);
		const pb = local(origin, b.loc);
		const along = unit(sub(pb, pa));
		if (!along) return graph;
		const normal: Vec = [-along[1] * distance, along[0] * distance];
		const shiftedA = add(pa, normal);
		const before =
			closed || index > 0 ? ring.at((index - 1 + n) % n) : undefined;
		const after = closed || index + 2 < n ? ring[(index + 2) % n] : undefined;
		const end = (point: Vec, neighbour: Loc | undefined): Vec => {
			const moved = add(point, normal);
			if (!neighbour) return moved;
			const direction = sub(point, local(origin, neighbour));
			return crossing(shiftedA, along, point, direction) ?? moved;
		};
		const newA = end(pa, before?.loc);
		const newB = end(pb, after?.loc);
		return graph
			.replace({ ...a, loc: fromLocal(origin, newA) })
			.replace({ ...b, loc: fromLocal(origin, newB) });
	};
}

/**
 * A parallel copy of a way, `distance` metres from it: inside a closed way when positive,
 * outside when negative; to the left of an open way's direction when positive. New nodes and
 * a new way with the same tags; each corner where the copy's offset sides meet.
 */
export function offsetWay(
	way: WayId,
	distance: number,
): (graph: Graph) => { graph: Graph; id: WayId } {
	return (graph) => {
		const entity = graph.entity(way);
		if (entity?.type !== "way") return { graph, id: way };
		const closed = isClosed(entity.nodes);
		const ring = ringOf(graph, way);
		const origin = ring[0]?.loc ?? [0, 0];
		const points = ring.map((node) => local(origin, node.loc));
		// Left of each side is inside a counterclockwise ring.
		const side = closed && signedArea(points) < 0 ? -distance : distance;
		const n = points.length;
		const offsetLine = (i: number) => {
			const p = points[i] as Vec;
			const q = points[(i + 1) % n] as Vec;
			const d = unit(sub(q, p)) ?? [1, 0];
			return { point: add(p, [-d[1] * side, d[0] * side]), d };
		};
		const corners = points.map((p, i): Vec => {
			const hasBefore = closed || i > 0;
			const hasAfter = closed || i < n - 1;
			const next = hasAfter ? offsetLine(i) : null;
			const previous = hasBefore ? offsetLine((i - 1 + n) % n) : null;
			if (next && previous) {
				return (
					crossing(previous.point, previous.d, next.point, next.d) ?? next.point
				);
			}
			const only = (next ?? previous) as { d: Vec };
			return add(p, [-only.d[1] * side, only.d[0] * side]);
		});
		let copy = graph;
		const ids: NodeId[] = [];
		for (const corner of corners) {
			const id = copy.newId("node");
			ids.push(id);
			copy = copy.replace({
				type: "node",
				id,
				version: 0,
				tags: {},
				loc: fromLocal(origin, corner),
			});
		}
		const id = copy.newId("way");
		copy = copy.replace({
			type: "way",
			id,
			version: 0,
			tags: { ...entity.tags },
			nodes: closed ? [...ids, ids[0] as NodeId] : ids,
		});
		return { graph: copy, id };
	};
}

/**
 * Squares a closed way to the frame turned `frameAngle` degrees: each side turns to the
 * frame axis nearest its direction, about its middle, and the corners are where the turned
 * sides meet. Sides that end up in line keep their shared corner on the line.
 */
export function squareToFrame(way: WayId, frameAngle: number): Action {
	return (graph) => {
		const entity = graph.entity(way);
		if (entity?.type !== "way" || !isClosed(entity.nodes)) return graph;
		const ring = ringOf(graph, way);
		const n = ring.length;
		if (n < 3) return graph;
		const origin = ring[0]?.loc ?? [0, 0];
		const points = ring.map((node) => local(origin, node.loc));
		const lines = points.map((p, i) => {
			const q = points[(i + 1) % n] as Vec;
			const angle = Math.atan2(q[1] - p[1], q[0] - p[0]) * (180 / Math.PI);
			const turns = Math.round((angle - frameAngle) / 90);
			const r = ((frameAngle + turns * 90) * Math.PI) / 180;
			return {
				point: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as Vec,
				d: [Math.cos(r), Math.sin(r)] as Vec,
			};
		});
		let squared = graph;
		ring.forEach((node, i) => {
			const previous = lines[(i - 1 + n) % n] as { point: Vec; d: Vec };
			const next = lines[i] as { point: Vec; d: Vec };
			const corner =
				crossing(previous.point, previous.d, next.point, next.d) ??
				project(points[i] as Vec, next);
			squared = squared.replace({ ...node, loc: fromLocal(origin, corner) });
		});
		return squared;
	};
}

/** A way's nodes in order, a closed way's closing node left out. */
function ringOf(graph: Graph, way: WayId) {
	const entity = graph.entity(way);
	if (entity?.type !== "way") return [];
	const nodes = graph.childNodes(entity);
	return isClosed(entity.nodes) ? nodes.slice(0, -1) : nodes;
}

function isClosed(nodes: readonly NodeId[]): boolean {
	return nodes.length > 2 && nodes[0] === nodes.at(-1);
}

function mapNodes(
	graph: Graph,
	nodes: ReadonlySet<NodeId>,
	move: (loc: Loc) => Loc,
): Graph {
	let moved = graph;
	for (const id of nodes) {
		const node = graph.entity(id);
		if (node?.type !== "node") continue;
		moved = moved.replace({ ...node, loc: move(node.loc) });
	}
	return moved;
}

const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];

function unit([x, y]: Vec): Vec | null {
	const length = Math.hypot(x, y);
	return length === 0 ? null : [x / length, y / length];
}

/** Where line p + t·d meets line q + s·e, or null when they are parallel. */
function crossing(p: Vec, d: Vec, q: Vec, e: Vec): Vec | null {
	const denominator = d[0] * e[1] - d[1] * e[0];
	if (Math.abs(denominator) < 1e-9 * Math.hypot(...d) * Math.hypot(...e))
		return null;
	const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / denominator;
	return [p[0] + t * d[0], p[1] + t * d[1]];
}

function project(p: Vec, { point, d }: { point: Vec; d: Vec }): Vec {
	const t = (p[0] - point[0]) * d[0] + (p[1] - point[1]) * d[1];
	return [point[0] + t * d[0], point[1] + t * d[1]];
}

function signedArea(points: readonly Vec[]): number {
	let area = 0;
	for (let i = 0; i < points.length; i++) {
		const [x1, y1] = points[i] as Vec;
		const [x2, y2] = points[(i + 1) % points.length] as Vec;
		area += x1 * y2 - x2 * y1;
	}
	return area / 2;
}
