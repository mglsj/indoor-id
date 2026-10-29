/**
 * Split across rooms (P5.3.5), as osm-simple3d-editor's split: one cut line (a polyline) cuts
 * every room, corridor and area it crosses, wherever it runs inside one for more than 0.5 m.
 * Where the cut crosses a side it gets a node, shared by the pieces on both sides and put into
 * the indoor ways along that side too (a neighbour's wall), but not into building outlines; a
 * crossing within 5 cm of a corner uses the corner. The largest piece of each area keeps its
 * id and history; the others are new ways with its tags, in its relations with its role.
 */
import type { Loc, NodeId, Way, WayId } from "#lib/osm/entity.ts";
import {
	fromMercator,
	isClosedRing,
	pointInRing,
	toMercator,
} from "#lib/osm/geometry.ts";
import { type Graph, getEntity } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";

/** The `indoor` values a cut splits. */
const SPLIT = new Set(["room", "area", "corridor"]);
/** A cut runs inside an area for at least this long (metres on the ground) to split it. */
const MIN_CHORD = 0.5;
/** A crossing this close to a corner (metres) goes through the corner. */
const SNAP = 0.05;

type Vec = [number, number];

/** Where the cut crosses a side of a ring: `t` along the cut (segment index + fraction). */
interface Crossing {
	readonly t: number;
	/** The side: from `ring[edge]` to `ring[edge + 1]`. */
	readonly edge: number;
	/** How far along the side, 0 to 1. */
	readonly u: number;
	readonly at: Vec;
}

/** A run of the cut inside an area: from one crossing to the next, through cut vertices. */
interface Chord {
	readonly from: Crossing;
	readonly to: Crossing;
	/** The cut's own vertices in between, in Mercator. */
	readonly inner: readonly Vec[];
}

/** Whether a cut would split this way: an indoor room, corridor or area it runs through. */
function chordsOf(graph: Graph, way: Way, cut: readonly Vec[]): Chord[] {
	if (!SPLIT.has(way.tags.indoor ?? "") || !isClosedRing(way)) return [];
	const ring = way.nodes.map((n) =>
		toMercator(getEntity(graph, n, "node").loc),
	);
	const crossings: Crossing[] = [];
	for (let i = 1; i < cut.length; i++) {
		for (let j = 1; j < ring.length; j++) {
			const hit = intersect(
				cut[i - 1] as Vec,
				cut[i] as Vec,
				ring[j - 1] as Vec,
				ring[j] as Vec,
			);
			if (hit)
				crossings.push({ t: i - 1 + hit.s, edge: j - 1, u: hit.u, at: hit.at });
		}
	}
	crossings.sort((a, b) => a.t - b.t);
	const chords: Chord[] = [];
	for (let k = 1; k < crossings.length; k++) {
		const from = crossings[k - 1] as Crossing;
		const to = crossings[k] as Crossing;
		const inner = cut.filter((_, i) => i > from.t && i < to.t);
		const path = [from.at, ...inner, to.at];
		if (groundLength(path) < MIN_CHORD) continue;
		if (!pointInRing(halfway(path), ring)) continue;
		chords.push({ from, to, inner });
	}
	return chords;
}

/** The ways among `candidates` that a cut along `cut` ([lon, lat] positions) would split. */
export function splitTargets(
	graph: Graph,
	cut: readonly Loc[],
	candidates: readonly WayId[],
): WayId[] {
	const line = cut.map((p) => toMercator(p));
	return [...new Set(candidates)].filter((id) => {
		const way = graph.entity(id);
		return way?.type === "way" && chordsOf(graph, way, line).length > 0;
	});
}

/** Splits the ways among `candidates` that the cut runs through (see `splitTargets`). */
export function splitAreas(
	cut: readonly Loc[],
	candidates: readonly WayId[],
): Action {
	return (graph: Graph) => {
		const line = cut.map((p) => toMercator(p));
		let g = graph;
		for (const id of new Set(candidates)) {
			const way = g.entity(id);
			if (way?.type !== "way") continue;
			// Each way is cut on the graph its neighbours' cuts left: their crossings on a shared
			// side are its corners now, and are used again.
			const chords = chordsOf(g, way, line);
			if (chords.length > 0) g = splitWay(g, way, chords);
		}
		return g;
	};
}

function splitWay(graph: Graph, way: Way, chords: readonly Chord[]): Graph {
	let g = graph;
	const ring = way.nodes;
	// The node at each crossing: a corner within 5 cm, else a new node on the side.
	const nodeAt = new Map<Crossing, NodeId>();
	const added = new Map<number, { u: number; id: NodeId }[]>();
	for (const chord of chords) {
		for (const crossing of [chord.from, chord.to]) {
			if (nodeAt.has(crossing)) continue;
			const a = ring[crossing.edge] as NodeId;
			const b = ring[crossing.edge + 1] as NodeId;
			const corner = [a, b].find(
				(n) =>
					groundDistance(toMercator(getEntity(g, n, "node").loc), crossing.at) <
					SNAP,
			);
			const onSide = added.get(crossing.edge) ?? [];
			const near = onSide.find((n) => Math.abs(n.u - crossing.u) < 1e-9);
			let id = corner ?? near?.id;
			if (!id) {
				id = g.newId("node");
				g = g.replace({
					type: "node",
					id,
					loc: fromMercator(crossing.at),
					tags: {},
				});
				onSide.push({ u: crossing.u, id });
				added.set(crossing.edge, onSide);
			}
			nodeAt.set(crossing, id);
		}
	}
	// New nodes go into this way's sides and the same sides of indoor ways along them.
	const sides = new Map<string, NodeId[]>();
	for (const [edge, nodes] of added) {
		const a = ring[edge] as NodeId;
		const b = ring[edge + 1] as NodeId;
		const ordered = [...nodes].sort((x, y) => x.u - y.u).map((n) => n.id);
		sides.set(`${a} ${b}`, ordered);
		sides.set(`${b} ${a}`, [...ordered].reverse());
	}
	const neighbours = new Set<Way>();
	for (const n of new Set(ring)) {
		for (const w of g.parentWays(n)) {
			if (w.id === way.id || w.tags.indoor !== undefined) neighbours.add(w);
		}
	}
	for (const w of neighbours) {
		const nodes = withSides(w.nodes, sides);
		if (nodes.length !== w.nodes.length) g = g.replace({ ...w, nodes });
	}

	// Split the ring along each chord, in the piece holding both its ends.
	let pieces: NodeId[][] = [withSides(ring, sides)];
	for (const chord of chords) {
		const from = nodeAt.get(chord.from) as NodeId;
		const to = nodeAt.get(chord.to) as NodeId;
		if (from === to) continue;
		const inner = chord.inner.map((at) => {
			const id = g.newId("node");
			g = g.replace({ type: "node", id, loc: fromMercator(at), tags: {} });
			return id;
		});
		const mid = halfway([chord.from.at, ...chord.inner, chord.to.at]);
		const index = pieces.findIndex(
			(p) =>
				p.includes(from) && p.includes(to) && pointInRing(mid, locsOf(g, p)),
		);
		const piece = pieces[index];
		if (!piece) continue;
		const cut = cutRing(piece, from, to, inner);
		if (!cut) continue;
		pieces = [...pieces.slice(0, index), ...cut, ...pieces.slice(index + 1)];
	}
	if (pieces.length < 2) return g;

	// The largest piece keeps the way; the others copy its tags and relations.
	pieces.sort((a, b) => ringArea(locsOf(g, b)) - ringArea(locsOf(g, a)));
	const [kept, ...others] = pieces as [NodeId[], ...NodeId[][]];
	g = g.replace({ ...getEntity(g, way.id, "way"), nodes: kept });
	for (const nodes of others) {
		const id = g.newId("way");
		g = g.replace({ type: "way", id, nodes, tags: { ...way.tags } });
		for (const relation of g.parentRelations(way.id)) {
			const members = relation.members.flatMap((m) =>
				m.ref === way.id ? [m, { ref: id, role: m.role }] : [m],
			);
			g = g.replace({ ...relation, members });
		}
	}
	return g;
}

/** A way's nodes with the new nodes of `sides` (keyed "a b") put between a and b. */
function withSides(
	nodes: readonly NodeId[],
	sides: ReadonlyMap<string, readonly NodeId[]>,
): NodeId[] {
	const result: NodeId[] = [];
	nodes.forEach((n, i) => {
		const previous = nodes[i - 1];
		if (previous) result.push(...(sides.get(`${previous} ${n}`) ?? []));
		result.push(n);
	});
	return result;
}

/**
 * The two rings a closed ring makes when cut from `from` to `to` through `inner`, both of
 * them nodes of the ring; null when one would have fewer than three corners.
 */
function cutRing(
	ring: readonly NodeId[],
	from: NodeId,
	to: NodeId,
	inner: readonly NodeId[],
): [NodeId[], NodeId[]] | null {
	const open = ring.slice(0, -1);
	const a = open.indexOf(from);
	const b = open.indexOf(to);
	const walk = (start: number, end: number) => {
		const out: NodeId[] = [];
		for (let i = start; ; i = (i + 1) % open.length) {
			out.push(open[i] as NodeId);
			if (i === end) return out;
		}
	};
	const one = [...walk(a, b), ...[...inner].reverse()];
	const two = [...walk(b, a), ...inner];
	if (new Set(one).size < 3 || new Set(two).size < 3) return null;
	return [
		[...one, from],
		[...two, to],
	];
}

function locsOf(graph: Graph, nodes: readonly NodeId[]): Vec[] {
	return nodes.map((n) => toMercator(getEntity(graph, n, "node").loc));
}

/** Where two segments cross: `s` along p–q, `u` along r–w, both 0 to 1. Parallel: none. */
function intersect(
	p: Vec,
	q: Vec,
	r: Vec,
	w: Vec,
): { s: number; u: number; at: Vec } | null {
	const d1: Vec = [q[0] - p[0], q[1] - p[1]];
	const d2: Vec = [w[0] - r[0], w[1] - r[1]];
	const denom = d1[0] * d2[1] - d1[1] * d2[0];
	if (Math.abs(denom) < 1e-12) return null;
	const e: Vec = [r[0] - p[0], r[1] - p[1]];
	const s = (e[0] * d2[1] - e[1] * d2[0]) / denom;
	const u = (e[0] * d1[1] - e[1] * d1[0]) / denom;
	const eps = 1e-9;
	if (s < -eps || s > 1 + eps || u < -eps || u > 1 + eps) return null;
	return { s, u, at: [p[0] + s * d1[0], p[1] + s * d1[1]] };
}

/** Mercator metres at this point make this many metres on the ground. */
function groundScale([, y]: Vec): number {
	return Math.cos((fromMercator([0, y])[1] * Math.PI) / 180);
}

function groundDistance(a: Vec, b: Vec): number {
	return Math.hypot(a[0] - b[0], a[1] - b[1]) * groundScale(a);
}

function groundLength(path: readonly Vec[]): number {
	let length = 0;
	for (let i = 1; i < path.length; i++) {
		length += groundDistance(path[i - 1] as Vec, path[i] as Vec);
	}
	return length;
}

/** The point halfway along a path. */
function halfway(path: readonly Vec[]): Vec {
	let left = groundLength(path) / 2;
	for (let i = 1; i < path.length; i++) {
		const a = path[i - 1] as Vec;
		const b = path[i] as Vec;
		const step = groundDistance(a, b);
		if (step >= left && step > 0) {
			const f = left / step;
			return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])];
		}
		left -= step;
	}
	return path.at(-1) as Vec;
}

function ringArea(points: readonly Vec[]): number {
	let sum = 0;
	for (let i = 1; i < points.length; i++) {
		const [x0, y0] = points[i - 1] as Vec;
		const [x1, y1] = points[i] as Vec;
		sum += x0 * y1 - x1 * y0;
	}
	return Math.abs(sum) / 2;
}
