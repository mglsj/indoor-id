import type { Loc, NodeId, WayId } from "#lib/osm/entity.ts";
import { type Graph, getEntity } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";
import type { Tags } from "#lib/osm/tags.ts";

/** Creates a node. Get a fresh id from `graph.newId("node")`. */
export function addNode(id: NodeId, loc: Loc, tags: Tags = {}): Action {
	return (graph: Graph) => graph.replace({ type: "node", id, loc, tags });
}

/** Moves a node; every way using it follows, since ways only reference nodes. */
export function moveNode(id: NodeId, loc: Loc): Action {
	return (graph: Graph) =>
		graph.replace({ ...getEntity(graph, id, "node"), loc });
}

/** Creates a way through existing nodes. Repeat the first node at the end for an area. */
export function addWay(
	id: WayId,
	nodes: readonly NodeId[],
	tags: Tags = {},
): Action {
	return (graph: Graph) => {
		for (const node of nodes) getEntity(graph, node, "node");
		return graph.replace({ type: "way", id, nodes, tags });
	};
}

/** Inserts an existing node into a way at `index`, e.g. to put a door on a wall. */
export function insertNodeInWay(
	wayId: WayId,
	nodeId: NodeId,
	index: number,
): Action {
	return (graph: Graph) => {
		const way = getEntity(graph, wayId, "way");
		getEntity(graph, nodeId, "node");
		const nodes = [...way.nodes];
		nodes.splice(index, 0, nodeId);
		return graph.replace({ ...way, nodes });
	};
}

/**
 * Makes a node a vertex of the segment from `a` to `b`, in every way where they follow each
 * other (either way round): the walls, rooms and outlines sharing that side all get it.
 */
export function insertNodeInSegment(
	nodeId: NodeId,
	a: NodeId,
	b: NodeId,
): Action {
	return (graph: Graph) => {
		getEntity(graph, nodeId, "node");
		let g = graph;
		for (const way of graph.parentWays(a)) {
			const nodes: NodeId[] = [];
			let changed = false;
			way.nodes.forEach((id, i) => {
				nodes.push(id);
				const next = way.nodes[i + 1];
				if (
					next !== undefined &&
					((id === a && next === b) || (id === b && next === a))
				) {
					nodes.push(nodeId);
					changed = true;
				}
			});
			if (changed) g = g.replace({ ...way, nodes });
		}
		return g;
	};
}

/** Creates a node at `loc` on the segment from `a` to `b`, in every way sharing it. */
export function addVertex(
	nodeId: NodeId,
	loc: Loc,
	a: NodeId,
	b: NodeId,
): Action {
	return (graph: Graph) =>
		insertNodeInSegment(nodeId, a, b)(addNode(nodeId, loc)(graph));
}
