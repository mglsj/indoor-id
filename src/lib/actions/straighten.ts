/**
 * Straightening a whole outline drawn by hand, as a CAD drawing would have it: every side
 * turned to a multiple of an angle step (45° or 90°) from the drawing frame, and a symmetric
 * building made exactly symmetric. Both keep the outline where it was drawn and move its
 * existing nodes (no node is added or removed, so rooms sharing them stay joined). Worked in
 * metres around a local origin (`local`/`fromLocal`), where angles and lengths are true.
 */
import type { Loc, Node, WayId } from "#lib/osm/entity.ts";
import { fromLocal, local } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";

type Vec = [number, number];

interface Line {
	readonly point: Vec;
	/** Unit direction. */
	readonly d: Vec;
}

/** A closed way's nodes in order, its closing node left out; null for anything else. */
function ringOf(graph: Graph, way: WayId): Node[] | null {
	const entity = graph.entity(way);
	if (entity?.type !== "way") return null;
	const { nodes } = entity;
	if (nodes.length < 4 || nodes[0] !== nodes.at(-1)) return null;
	const ring = graph.childNodes(entity).slice(0, -1);
	return ring.length === nodes.length - 1 ? ring : null;
}

/** Moves each node of `ring` to its new place, in metres from `origin`. */
function place(
	graph: Graph,
	ring: readonly Node[],
	origin: Loc,
	points: readonly Vec[],
): Graph {
	let moved = graph;
	ring.forEach((node, i) => {
		const p = points[i];
		if (p) moved = moved.replace({ ...node, loc: fromLocal(origin, p) });
	});
	return moved;
}

/**
 * Turns every side of a closed way to the nearest multiple of `step` degrees from the frame
 * turned `frameAngle` degrees (counterclockwise from east). Neighbouring sides that end up in
 * the same direction form one straight run, placed through their middles weighted by length,
 * with the points between them moved onto it; the corners are where runs meet. Anything but a
 * closed way is left alone.
 */
export function straightenToFrame(
	way: WayId,
	frameAngle: number,
	step: 45 | 90,
): Action {
	return (graph) => {
		const ring = ringOf(graph, way);
		if (!ring || ring.length < 3) return graph;
		const n = ring.length;
		const origin = ring[0]?.loc ?? [0, 0];
		const points = ring.map((node) => local(origin, node.loc) as Vec);
		// Each side's direction, in steps from the frame (0 … 360 / step - 1).
		const turns = 360 / step;
		const sides = points.map((p, i) => {
			const q = points[(i + 1) % n] as Vec;
			const angle = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
			const k = Math.round((angle - frameAngle) / step);
			return {
				turn: ((k % turns) + turns) % turns,
				middle: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as Vec,
				length: Math.hypot(q[0] - p[0], q[1] - p[1]),
			};
		});
		// Runs of sides in one direction, starting where the direction changes.
		const start = sides.findIndex(
			(s, i) => s.turn !== (sides[(i - 1 + n) % n]?.turn ?? s.turn),
		);
		if (start < 0) return graph;
		const runOf = new Array<number>(n);
		const lines: Line[] = [];
		let members: number[] = [];
		const close = () => {
			const turn = sides[members[0] ?? 0]?.turn ?? 0;
			const r = ((frameAngle + turn * step) * Math.PI) / 180;
			const d: Vec = [Math.cos(r), Math.sin(r)];
			const normal: Vec = [-d[1], d[0]];
			let weight = 0;
			let offset = 0;
			for (const i of members) {
				const side = sides[i];
				if (!side) continue;
				const w = Math.max(side.length, 1e-9);
				weight += w;
				offset += w * dot(side.middle, normal);
			}
			offset /= weight;
			lines.push({ point: [normal[0] * offset, normal[1] * offset], d });
			members = [];
		};
		for (let k = 0; k < n; k++) {
			const i = (start + k) % n;
			const side = sides[i];
			const previous = sides[(i - 1 + n) % n];
			if (k > 0 && side?.turn !== previous?.turn) close();
			members.push(i);
			runOf[i] = lines.length;
		}
		close();
		const moved = points.map((p, i) => {
			const before = lines[runOf[(i - 1 + n) % n] ?? 0] as Line;
			const after = lines[runOf[i] ?? 0] as Line;
			if (before === after) return project(p, after);
			return crossing(before, after) ?? project(p, after);
		});
		return place(graph, ring, origin, moved);
	};
}

/**
 * Makes a closed way symmetric about a mirror line along the frame's axes or diagonals (the
 * one its corners fit best), through the outline's middle: each node is paired with the node
 * nearest its mirror image (within 1.5 m, or 8% of the outline's size if more), and each pair
 * moved to mirror each other exactly, halfway; a node paired with itself goes onto the line.
 * Left alone when some node has no twin on every candidate line.
 */
export function makeSymmetric(way: WayId, frameAngle: number): Action {
	return (graph) => {
		const ring = ringOf(graph, way);
		if (!ring || ring.length < 3) return graph;
		const origin = ring[0]?.loc ?? [0, 0];
		const points = ring.map((node) => local(origin, node.loc) as Vec);
		const xs = points.map((p) => p[0]);
		const ys = points.map((p) => p[1]);
		const size = Math.hypot(
			Math.max(...xs) - Math.min(...xs),
			Math.max(...ys) - Math.min(...ys),
		);
		const tolerance = Math.max(1.5, size * 0.08);
		let best: { mirror: Mirror; twins: number[]; error: number } | null = null;
		for (const extra of [0, 90, 45, 135]) {
			const found = fitMirror(points, frameAngle + extra, tolerance);
			if (found && (!best || found.error < best.error)) best = found;
		}
		if (!best) return graph;
		const { mirror, twins } = best;
		const moved = points.map((p, i) => {
			const twin = points[twins[i] ?? i] as Vec;
			const image = mirror.reflect(twin);
			return [(p[0] + image[0]) / 2, (p[1] + image[1]) / 2] as Vec;
		});
		return place(graph, ring, origin, moved);
	};
}

interface Mirror {
	reflect(p: Vec): Vec;
}

/** A mirror line in direction `angle` that pairs every point with a twin, or null. */
function fitMirror(
	points: readonly Vec[],
	angle: number,
	tolerance: number,
): { mirror: Mirror; twins: number[]; error: number } | null {
	const r = (angle * Math.PI) / 180;
	const normal: Vec = [-Math.sin(r), Math.cos(r)];
	// Through the middle first, then through the pairs' middles.
	let offset =
		points.reduce((sum, p) => sum + dot(p, normal), 0) / points.length;
	let twins: number[] = [];
	let error = 0;
	for (let round = 0; round < 3; round++) {
		const c = offset;
		const reflect = (p: Vec): Vec => {
			const t = 2 * (dot(p, normal) - c);
			return [p[0] - t * normal[0], p[1] - t * normal[1]];
		};
		twins = points.map((p) => {
			const image = reflect(p);
			let nearest = -1;
			let distance = tolerance;
			points.forEach((q, j) => {
				const dq = Math.hypot(q[0] - image[0], q[1] - image[1]);
				if (dq <= distance) {
					distance = dq;
					nearest = j;
				}
			});
			return nearest;
		});
		if (twins.some((j, i) => j < 0 || twins[j] !== i)) return null;
		offset =
			points.reduce(
				(sum, p, i) =>
					sum +
					(dot(p, normal) + dot(points[twins[i] ?? i] as Vec, normal)) / 2,
				0,
			) / points.length;
		error =
			points.reduce((sum, p, i) => {
				const image = reflect(points[twins[i] ?? i] as Vec);
				return sum + Math.hypot(p[0] - image[0], p[1] - image[1]);
			}, 0) / points.length;
	}
	const c = offset;
	return {
		mirror: {
			reflect: (p) => {
				const t = 2 * (dot(p, normal) - c);
				return [p[0] - t * normal[0], p[1] - t * normal[1]];
			},
		},
		twins,
		error,
	};
}

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];

/** The foot of the perpendicular from `p` on a line. */
function project(p: Vec, { point, d }: Line): Vec {
	const t = (p[0] - point[0]) * d[0] + (p[1] - point[1]) * d[1];
	return [point[0] + t * d[0], point[1] + t * d[1]];
}

/** Where two lines cross, or null when they are parallel. */
function crossing(a: Line, b: Line): Vec | null {
	const det = a.d[0] * b.d[1] - a.d[1] * b.d[0];
	if (Math.abs(det) < 1e-9) return null;
	const dx = b.point[0] - a.point[0];
	const dy = b.point[1] - a.point[1];
	const t = (dx * b.d[1] - dy * b.d[0]) / det;
	return [a.point[0] + t * a.d[0], a.point[1] + t * a.d[1]];
}
