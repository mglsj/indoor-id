/**
 * Disconnect (P5.3.5), as iD's: a vertex shared by several ways gets a copy for each way but
 * the first, so they can move apart; a way gets its own copy of every node it shares with
 * other ways (a room detached from the building outline, osm-simple3d-editor's "detach").
 * Tags stay on the original node; copies are untagged.
 */
import type { NodeId, WayId } from "#lib/osm/entity.ts";
import { type Graph, getEntity } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";

/** Whether `id` (a node or a way) shares a node with another way. */
export function canDisconnect(graph: Graph, id: NodeId | WayId): boolean {
	const entity = graph.entity(id);
	if (entity?.type === "node") return graph.parentWays(entity.id).length > 1;
	if (entity?.type === "way") {
		return entity.nodes.some((n) =>
			graph.parentWays(n).some((w) => w.id !== entity.id),
		);
	}
	return false;
}

export function disconnect(id: NodeId | WayId): Action {
	return (graph: Graph) =>
		id.startsWith("n")
			? disconnectNode(graph, id as NodeId)
			: disconnectWay(graph, id as WayId);
}

function disconnectNode(graph: Graph, id: NodeId): Graph {
	const node = getEntity(graph, id, "node");
	let g = graph;
	for (const way of graph.parentWays(id).slice(1)) {
		const copy = g.newId("node");
		g = g.replace({ type: "node", id: copy, loc: node.loc, tags: {} });
		g = g.replace({
			...way,
			nodes: way.nodes.map((n) => (n === id ? copy : n)),
		});
	}
	return g;
}

function disconnectWay(graph: Graph, id: WayId): Graph {
	const way = getEntity(graph, id, "way");
	let g = graph;
	const copies = new Map<NodeId, NodeId>();
	for (const n of new Set(way.nodes)) {
		if (!graph.parentWays(n).some((w) => w.id !== id)) continue;
		const node = getEntity(graph, n, "node");
		const copy = g.newId("node");
		copies.set(n, copy);
		g = g.replace({ type: "node", id: copy, loc: node.loc, tags: {} });
	}
	return g.replace({
		...way,
		nodes: way.nodes.map((n) => copies.get(n) ?? n),
	});
}
