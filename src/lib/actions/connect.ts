/**
 * Joins one node into another, as iD's `actionConnect`: the ways and relations using `from`
 * use `into` instead, `into` keeps its place, and `from` is deleted. A dragged vertex dropped
 * on another node joins it this way, so walls and rooms share their corners.
 */
import { type NodeId, sameTags } from "#lib/osm/entity.ts";
import { isClosed } from "#lib/osm/geometry.ts";
import { type Graph, getEntity } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";
import { hasInterestingTags } from "#lib/osm/tags.ts";

/** Why two nodes can't be joined. */
export type ConnectRefusal = "tags" | "collapses";

/**
 * Whether `from` can join `into`: not when both carry different tags (two doors), nor when a
 * way would be left with fewer than two nodes (an area fewer than three corners).
 */
export function connectRefusal(
	graph: Graph,
	from: NodeId,
	into: NodeId,
): ConnectRefusal | null {
	const a = getEntity(graph, from, "node");
	const b = getEntity(graph, into, "node");
	if (
		hasInterestingTags(a.tags) &&
		hasInterestingTags(b.tags) &&
		!sameTags(a.tags, b.tags)
	) {
		return "tags";
	}
	for (const way of graph.parentWays(from)) {
		const nodes = joined(way.nodes, from, into);
		const corners = isClosed(way) ? nodes.length - 1 : nodes.length;
		if (corners < (isClosed(way) ? 3 : 2)) return "collapses";
	}
	return null;
}

export function connectNodes(from: NodeId, into: NodeId): Action {
	return (graph: Graph) => {
		const a = getEntity(graph, from, "node");
		const b = getEntity(graph, into, "node");
		let g = graph;
		for (const way of graph.parentWays(from)) {
			g = g.replace({ ...way, nodes: joined(way.nodes, from, into) });
		}
		for (const relation of graph.parentRelations(from)) {
			g = g.replace({
				...relation,
				members: relation.members.map((m) =>
					m.ref === from ? { ...m, ref: into } : m,
				),
			});
		}
		if (!hasInterestingTags(b.tags) && hasInterestingTags(a.tags)) {
			g = g.replace({ ...b, tags: a.tags });
		}
		return g.remove(from);
	};
}

/** A way's nodes with `from` replaced by `into`, the same node never twice in a row. */
function joined(
	nodes: readonly NodeId[],
	from: NodeId,
	into: NodeId,
): NodeId[] {
	const result: NodeId[] = [];
	for (const id of nodes) {
		const node = id === from ? into : id;
		if (result.at(-1) !== node) result.push(node);
	}
	return result;
}
