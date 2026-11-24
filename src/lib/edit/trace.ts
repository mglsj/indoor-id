/**
 * Tracing along existing outlines (P6, osm-simple3d-editor's deferred "tracing along existing
 * edges", as QGIS's tracing): the nodes between two corners of a drawing along the ways joining
 * them, the shortest way in metres (Dijkstra). Only the ways `follows` allows (the ones drawn
 * on the shown level) are walked; nodes are visited as they are reached, so a click costs what
 * lies around it, not the whole data. Pure.
 */
import type { NodeId, Way } from "#lib/osm/entity.ts";
import { local } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";

/** Gives up past this many nodes: the corners are too far apart along the ways. */
const MAX_VISITED = 5000;

/**
 * The nodes strictly between `from` and `to` along the ways, in order; `[]` when they are
 * neighbours on a way, null when nothing joins them (or `from` is `to`).
 */
export function tracePath(
	graph: Graph,
	from: NodeId,
	to: NodeId,
	follows: (way: Way) => boolean,
): NodeId[] | null {
	if (from === to) return null;
	const start = graph.entity(from);
	if (start?.type !== "node") return null;
	const origin = start.loc;
	const position = (id: NodeId) => {
		const n = graph.entity(id);
		return n?.type === "node" ? local(origin, n.loc) : null;
	};
	const distance = new Map<NodeId, number>([[from, 0]]);
	const previous = new Map<NodeId, NodeId>();
	const done = new Set<NodeId>();
	const queue: { id: NodeId; d: number }[] = [{ id: from, d: 0 }];
	while (queue.length > 0 && done.size < MAX_VISITED) {
		// A small queue: the nearest first.
		let best = 0;
		for (let i = 1; i < queue.length; i++)
			if ((queue[i]?.d ?? 0) < (queue[best]?.d ?? 0)) best = i;
		const [{ id, d }] = queue.splice(best, 1) as [{ id: NodeId; d: number }];
		if (done.has(id)) continue;
		done.add(id);
		if (id === to) break;
		const here = position(id);
		if (!here) continue;
		for (const way of graph.parentWays(id)) {
			if (!follows(way)) continue;
			for (const next of neighbours(way, id)) {
				if (done.has(next)) continue;
				const there = position(next);
				if (!there) continue;
				const step = Math.hypot(there[0] - here[0], there[1] - here[1]);
				const through = d + step;
				if (through < (distance.get(next) ?? Number.POSITIVE_INFINITY)) {
					distance.set(next, through);
					previous.set(next, id);
					queue.push({ id: next, d: through });
				}
			}
		}
	}
	if (!done.has(to)) return null;
	const path: NodeId[] = [];
	for (let id = previous.get(to); id && id !== from; id = previous.get(id))
		path.unshift(id);
	return path;
}

/** The nodes next to `id` along a way (a closed way's ends join). */
function neighbours(way: Way, id: NodeId): NodeId[] {
	const nodes = way.nodes;
	const found: NodeId[] = [];
	const last = nodes.length - 1;
	const closed = nodes[0] === nodes[last];
	for (let i = 0; i < nodes.length; i++) {
		if (nodes[i] !== id) continue;
		const before = i > 0 ? nodes[i - 1] : closed ? nodes[last - 1] : undefined;
		const after = i < last ? nodes[i + 1] : closed ? nodes[1] : undefined;
		if (before && before !== id) found.push(before);
		if (after && after !== id) found.push(after);
	}
	return found;
}
