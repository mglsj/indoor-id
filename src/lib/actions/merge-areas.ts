/**
 * Merge rooms (P5.3.5), as osm-simple3d-editor's merge: closed ways with the same `indoor`,
 * `room`, `level` and `repeat_on` that share a side become one. The largest keeps its id,
 * history and tags (the others' tags it lacks are added); the sides they shared go, and with
 * them the nodes nothing else uses (`deleteEntities`' cleanup).
 */
import type { NodeId, Way, WayId } from "#lib/osm/entity.ts";
import { isClosed, toMercator } from "#lib/osm/geometry.ts";
import { type Graph, getEntity } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";
import { deleteEntities } from "./delete.ts";

export type MergeRefusal = "not_areas" | "different_tags" | "not_adjacent";

/** The tags merged rooms must share. */
const SAME = ["indoor", "room", "level", "repeat_on"] as const;

export function mergeRefusal(
	graph: Graph,
	ids: readonly string[],
): MergeRefusal | null {
	const ways = areasOf(graph, ids);
	if (!ways) return "not_areas";
	const [first] = ways;
	if (ways.some((w) => SAME.some((k) => w.tags[k] !== first?.tags[k])))
		return "different_tags";
	return mergedRing(ways) ? null : "not_adjacent";
}

export function mergeAreas(ids: readonly WayId[]): Action {
	return (graph: Graph) => {
		const ways = areasOf(graph, ids);
		const ring = ways && mergedRing(ways);
		if (!ways || !ring) return graph;
		const [keep, ...others] = [...ways].sort(
			(a, b) => areaOf(graph, b) - areaOf(graph, a),
		) as [Way, ...Way[]];
		const tags = { ...keep.tags };
		for (const other of others) {
			for (const [k, v] of Object.entries(other.tags)) tags[k] ??= v;
		}
		const g = graph.replace({ ...keep, nodes: ring, tags });
		return deleteEntities(others.map((w) => w.id))(g);
	};
}

/** The ways, when there are at least two and all are closed ways in no relation. */
function areasOf(graph: Graph, ids: readonly string[]): Way[] | null {
	if (ids.length < 2) return null;
	const ways: Way[] = [];
	for (const id of ids) {
		const way = graph.entity(id as WayId);
		if (way?.type !== "way" || !isClosed(way) || way.nodes.length < 4)
			return null;
		if (graph.parentRelations(way.id).length > 0) return null;
		ways.push(way);
	}
	return ways;
}

/**
 * The outline of the ways together: their sides less those two of them share, walked as one
 * ring (closed). Null when that isn't a single ring (not adjacent, or touching at a corner).
 */
function mergedRing(ways: readonly Way[]): NodeId[] | null {
	const count = new Map<string, number>();
	const key = (a: NodeId, b: NodeId) => (a < b ? `${a} ${b}` : `${b} ${a}`);
	for (const way of ways) {
		for (let i = 1; i < way.nodes.length; i++) {
			const k = key(way.nodes[i - 1] as NodeId, way.nodes[i] as NodeId);
			count.set(k, (count.get(k) ?? 0) + 1);
		}
	}
	const kept = [...count].filter(([, n]) => n === 1).map(([k]) => k);
	if (kept.length === count.size) return null; // no shared side
	const next = new Map<NodeId, NodeId[]>();
	for (const k of kept) {
		const [a, b] = k.split(" ") as [NodeId, NodeId];
		next.set(a, [...(next.get(a) ?? []), b]);
		next.set(b, [...(next.get(b) ?? []), a]);
	}
	if ([...next.values()].some((n) => n.length !== 2)) return null;
	const [start] = next.keys();
	if (!start) return null;
	const ring: NodeId[] = [start];
	let previous: NodeId | null = null;
	let current = start;
	for (;;) {
		const [a, b] = next.get(current) as [NodeId, NodeId];
		const following: NodeId = a !== previous ? a : b;
		if (following === start) break;
		ring.push(following);
		previous = current;
		current = following;
		if (ring.length > kept.length) return null;
	}
	return ring.length === kept.length ? [...ring, start] : null;
}

/** A closed way's area, in square Mercator metres. */
function areaOf(graph: Graph, way: Way): number {
	const pts = way.nodes.map((id) =>
		toMercator(getEntity(graph, id, "node").loc),
	);
	let sum = 0;
	for (let i = 1; i < pts.length; i++) {
		const [x0, y0] = pts[i - 1] as [number, number];
		const [x1, y1] = pts[i] as [number, number];
		sum += x0 * y1 - x1 * y0;
	}
	return Math.abs(sum) / 2;
}
