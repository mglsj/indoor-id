/**
 * The check of an upload before its changeset is opened (W3, after osm-simple3d-editor
 * `89b17a3`): what the server would refuse, or take and keep broken, is found here, so a
 * refused upload leaves no empty changeset behind. Only the edits are read: a way or relation
 * nobody edited is the server's business.
 */
import { type Entity, type EntityId, isNewId, type NodeId } from "./entity.ts";
import type { Graph } from "./graph.ts";
import { hasInterestingTags } from "./tags.ts";

export type UploadProblemKind =
	/** The same element listed twice in the change. */
	| "twice"
	/** A way or relation that refers to an element deleted in this upload. */
	| "refers-to-deleted"
	/** A way or relation that refers to a new element that isn't created. */
	| "refers-to-missing"
	/** A way with fewer than two nodes. */
	| "short-way"
	/** A way with the same node twice in a row. */
	| "repeated-node"
	/** A new way with no tags that no relation holds: a leftover (osm-simple3d-editor `43c1025`). */
	| "untagged-way"
	/** A deleted element still used by a way or relation that stays (its issues #86, #87). */
	| "still-used";

export interface UploadProblem {
	readonly kind: UploadProblemKind;
	readonly id: EntityId;
	/** The element it refers to or is used by, when there is one. */
	readonly other?: EntityId;
}

/** What is wrong with uploading the edits of `graph`; empty when it can go. */
export function uploadProblems(graph: Graph): UploadProblem[] {
	const { created, modified, deleted } = graph.changes();
	const problems: UploadProblem[] = [];
	const seen = new Set<EntityId>();
	for (const entity of [...created, ...modified, ...deleted]) {
		if (seen.has(entity.id)) problems.push({ kind: "twice", id: entity.id });
		seen.add(entity.id);
	}
	const gone = new Set(deleted.map((e) => e.id));
	const made = new Set(created.map((e) => e.id));
	const refersTo = (from: Entity, ref: EntityId) => {
		if (gone.has(ref))
			problems.push({ kind: "refers-to-deleted", id: from.id, other: ref });
		else if (isNewId(ref) && !made.has(ref))
			problems.push({ kind: "refers-to-missing", id: from.id, other: ref });
	};
	for (const entity of [...created, ...modified]) {
		if (entity.type === "way") {
			if (entity.nodes.length < 2)
				problems.push({ kind: "short-way", id: entity.id });
			for (let i = 1; i < entity.nodes.length; i++) {
				if (entity.nodes[i] === entity.nodes[i - 1]) {
					problems.push({
						kind: "repeated-node",
						id: entity.id,
						other: entity.nodes[i],
					});
					break;
				}
			}
			for (const ref of new Set<NodeId>(entity.nodes)) refersTo(entity, ref);
			if (
				made.has(entity.id) &&
				!hasInterestingTags(entity.tags) &&
				graph.parentRelations(entity.id).length === 0
			)
				problems.push({ kind: "untagged-way", id: entity.id });
		} else if (entity.type === "relation") {
			for (const ref of new Set(entity.members.map((m) => m.ref)))
				refersTo(entity, ref);
		}
	}
	// What still uses a deleted element without being edited (an edited user is listed above).
	for (const entity of deleted) {
		const users = [
			...(entity.type === "node" ? graph.parentWays(entity.id) : []),
			...graph.parentRelations(entity.id),
		];
		for (const user of users) {
			if (seen.has(user.id)) continue;
			problems.push({ kind: "still-used", id: entity.id, other: user.id });
		}
	}
	return problems;
}
