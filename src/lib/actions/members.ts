/**
 * Relation membership edits, as iD's `actionAddMember`, `actionChangeMember`,
 * `actionDeleteMembers` and `actionMoveMember`. Members are added at the end: indoor relations
 * (multipolygons, sites, buildings, levels) don't depend on their order, so iD's way joining
 * (for routes) isn't ported.
 */
import { deleteEntities } from "#lib/actions/delete.ts";
import type { Member, Relation, RelationId } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";

function relationIn(graph: Graph, id: RelationId): Relation {
	const relation = graph.entity(id);
	if (relation?.type !== "relation") throw new Error(`Unknown relation ${id}`);
	return relation;
}

export function addMember(id: RelationId, member: Member): Action {
	return (graph) => {
		const relation = relationIn(graph, id);
		return graph.replace({
			...relation,
			members: [...relation.members, member],
		});
	};
}

/** A new relation, without tags yet, holding `member`; `id` comes from `graph.newId`. */
export function addToNewRelation(id: RelationId, member: Member): Action {
	return (graph) =>
		graph.replace({ type: "relation", id, tags: {}, members: [member] });
}

export function changeMemberRoles(
	id: RelationId,
	indexes: readonly number[],
	role: string,
): Action {
	return (graph) => {
		const relation = relationIn(graph, id);
		return graph.replace({
			...relation,
			members: relation.members.map((m, i) =>
				indexes.includes(i) ? { ...m, role } : m,
			),
		});
	};
}

/** Removes members; a relation left empty is deleted, as iD's `actionDeleteMember`. */
export function removeMembers(
	id: RelationId,
	indexes: readonly number[],
): Action {
	return (graph) => {
		const relation = relationIn(graph, id);
		const members = relation.members.filter((_, i) => !indexes.includes(i));
		return members.length === 0
			? deleteEntities([id])(graph)
			: graph.replace({ ...relation, members });
	};
}

export function moveMember(id: RelationId, from: number, to: number): Action {
	return (graph) => {
		const relation = relationIn(graph, id);
		const members = [...relation.members];
		const [moved] = members.splice(from, 1);
		if (!moved) return graph;
		members.splice(to, 0, moved);
		return graph.replace({ ...relation, members });
	};
}
