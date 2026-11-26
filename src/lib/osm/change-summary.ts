/**
 * The features an upload changes, as the save dialog lists them: a moved untagged vertex is
 * named by its ways, a new way's untagged nodes by the way. Follows iD's
 * `coreDifference.summary()` (`openstreetmap/iD`, ISC).
 */
import { type Entity, type EntityId, type Node, sameTags } from "./entity.ts";
import type { Graph } from "./graph.ts";
import { hasInterestingTags } from "./tags.ts";

export type ChangeKind = "created" | "modified" | "deleted";

export interface SummaryChange {
	readonly kind: ChangeKind;
	/** The current version, or the downloaded one when deleted. */
	readonly entity: Entity;
}

const ORDER: Record<ChangeKind, number> = {
	created: 0,
	modified: 1,
	deleted: 2,
};

/** The changed features of `graph` against its server data: created, then modified, then deleted. */
export function changeSummary(graph: Graph): SummaryChange[] {
	const base = graph.base();
	const { created, modified, deleted } = graph.changes();
	const relevant = new Map<EntityId, SummaryChange>();
	const add = (entity: Entity, kind: ChangeKind) => {
		relevant.set(entity.id, { kind, entity });
	};
	const addParents = (node: Node) => {
		for (const parent of graph.parentWays(node.id)) {
			if (!relevant.has(parent.id)) add(parent, "modified");
		}
	};
	const isVertex = (entity: Entity, in_: Graph) =>
		entity.type === "node" && in_.parentWays(entity.id).length > 0;

	for (const entity of created) {
		if (!isVertex(entity, graph) || hasInterestingTags(entity.tags))
			add(entity, "created");
	}
	for (const entity of modified) {
		const before = base.entity(entity.id);
		if (!isVertex(entity, graph) || before?.type !== "node") {
			add(entity, "modified");
			continue;
		}
		const node = entity as Node;
		const moved =
			before.loc[0] !== node.loc[0] || before.loc[1] !== node.loc[1];
		const retagged = !sameTags(before.tags, node.tags);
		if (moved) addParents(node);
		if (retagged || (moved && hasInterestingTags(node.tags)))
			add(node, "modified");
	}
	for (const entity of deleted) {
		if (!isVertex(entity, base) || hasInterestingTags(entity.tags))
			add(entity, "deleted");
	}
	return [...relevant.values()].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
}
