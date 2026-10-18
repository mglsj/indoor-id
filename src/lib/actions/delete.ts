import type { EntityId, NodeId, Way } from "#lib/osm/entity.ts";
import { isClosed } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";
import { hasInterestingTags } from "#lib/osm/tags.ts";

/**
 * Deletes entities and cleans up after them, like iD:
 * - a deleted entity is removed from its relations; relations left empty are deleted;
 * - a deleted node is removed from its ways; lines left with one node and areas left with
 *   fewer than three corners are deleted;
 * - a deleted way takes its nodes with it, unless they are tagged (POIs, doors), used by
 *   another way, or members of a relation;
 * - a deleted relation takes its members with it, unless they are tagged, used by a way or
 *   members of another relation.
 */
export function deleteEntities(ids: readonly EntityId[]): Action {
	return (graph: Graph) => ids.reduce(deleteEntity, graph);
}

function deleteEntity(graph: Graph, id: EntityId): Graph {
	const entity = graph.entity(id);
	if (!entity) return graph;

	let g = graph;
	for (const relation of g.parentRelations(id)) {
		g = removeMember(g, relation.id, id);
	}

	switch (entity.type) {
		case "node":
			for (const way of g.parentWays(entity.id)) {
				g = removeNodeFromWay(g, way.id, entity.id);
			}
			return g.remove(id);
		case "way": {
			g = g.remove(id);
			for (const node of new Set(entity.nodes)) {
				if (isOrphan(g, node)) g = deleteEntity(g, node);
			}
			return g;
		}
		case "relation": {
			// Members left untagged and unused go too (iD's actionDeleteRelation).
			g = g.remove(id);
			for (const ref of new Set(entity.members.map((m) => m.ref))) {
				if (isUnused(g, ref)) g = deleteEntity(g, ref);
			}
			return g;
		}
	}
}

/** Whether nothing holds or describes the entity any more: no tags, ways or relations. */
function isUnused(graph: Graph, id: EntityId): boolean {
	const entity = graph.entity(id);
	return (
		entity !== undefined &&
		!hasInterestingTags(entity.tags) &&
		(entity.type !== "node" || graph.parentWays(entity.id).length === 0) &&
		graph.parentRelations(id).length === 0
	);
}

function removeMember(
	graph: Graph,
	relationId: EntityId,
	memberId: EntityId,
): Graph {
	const relation = graph.entity(relationId);
	if (relation?.type !== "relation") return graph;
	const members = relation.members.filter((m) => m.ref !== memberId);
	return members.length === 0
		? deleteEntity(graph, relation.id)
		: graph.replace({ ...relation, members });
}

function removeNodeFromWay(
	graph: Graph,
	wayId: Way["id"],
	nodeId: NodeId,
): Graph {
	const way = graph.entity(wayId);
	if (way?.type !== "way") return graph;

	const closed = isClosed(way);
	const remaining = (closed ? way.nodes.slice(0, -1) : way.nodes).filter(
		(n) => n !== nodeId,
	);
	const nodes = removeConsecutiveDuplicates(remaining);

	if (closed) {
		return nodes.length < 3
			? deleteEntity(graph, wayId)
			: graph.replace({ ...way, nodes: [...nodes, nodes[0] as NodeId] });
	}
	return nodes.length < 2
		? deleteEntity(graph, wayId)
		: graph.replace({ ...way, nodes });
}

function removeConsecutiveDuplicates(nodes: readonly NodeId[]): NodeId[] {
	return nodes.filter((n, i) => n !== nodes[i - 1]);
}

function isOrphan(graph: Graph, id: NodeId): boolean {
	const node = graph.entity(id);
	return (
		node !== undefined &&
		!hasInterestingTags(node.tags) &&
		graph.parentWays(id).length === 0 &&
		graph.parentRelations(id).length === 0
	);
}
