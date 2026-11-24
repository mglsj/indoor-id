/**
 * Rebase before upload (P5.4b): the local edits are moved onto the server's current versions
 * of what they touch, so that someone else's edit made meanwhile doesn't refuse the upload.
 * Tag edits are merged key by key, a moved node or a way's new nodes are taken from whichever
 * side changed them, relation members added or removed on each side are both kept. What can't
 * be merged is a `Conflict`, which the user resolves by keeping their version or taking the
 * server's (`resolveConflict`). Modelled on iD's `actionMergeRemoteChanges` and the rebase of
 * osm-simple3d-editor.
 */
import { deleteEntities } from "#lib/actions/delete.ts";
import {
	type Entity,
	type EntityId,
	entityType,
	isNewId,
	type Member,
	type Node,
	type NodeId,
	type Relation,
	sameContent,
	type Way,
} from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";
import type { Tags } from "#lib/osm/tags.ts";

/** An entity as the server has it now: `entity` is null when it was deleted there. */
export interface Current {
	readonly id: EntityId;
	readonly version: number;
	readonly entity: Entity | null;
	/** Who made this version, if the server said. */
	readonly user?: string;
}

export type ConflictKind =
	/** Both changed the same tag, the same node's position, a way's nodes or a relation's order. */
	| "both-edited"
	/** They deleted what the user edited. */
	| "deleted-by-them"
	/** The user deleted what they edited. */
	| "deleted-by-me"
	/** They deleted something the user's edits still use (a way's node, a member). */
	| "deleted-in-use";

export interface Conflict {
	readonly id: EntityId;
	readonly kind: ConflictKind;
	/** The version downloaded, the edits were made on. */
	readonly base: Entity;
	/** The user's version, null when deleted. */
	readonly mine: Entity | null;
	/** The server's version now. */
	readonly theirs: Current;
	/** For `both-edited`: the tags both set to different values. */
	readonly keys: readonly string[];
	/** For `both-edited`: whether both changed the position, nodes or members. */
	readonly geometry: boolean;
}

/** What to do to the history: the server's data to take, then the edits to apply over it. */
export interface Rebase {
	/** Newer versions of entities, put under the edits. */
	readonly server: readonly Entity[];
	/** Entities deleted on the server, taken out of its data. */
	readonly gone: readonly EntityId[];
	/** The edits over the new server data (a history step). */
	readonly action: Action;
	/** How many edited entities took someone else's changes. */
	readonly merged: number;
	readonly conflicts: readonly Conflict[];
}

/**
 * The entities to fetch before an upload: those modified or deleted, and those the uploaded
 * ways and relations use (a node deleted on the server would make the upload fail).
 */
export function idsToCheck(graph: Graph): EntityId[] {
	const { created, modified, deleted } = graph.changes();
	const ids = new Set<EntityId>();
	for (const entity of [...modified, ...deleted]) {
		if (!isNewId(entity.id)) ids.add(entity.id);
	}
	const base = graph.base();
	for (const entity of [...created, ...modified]) {
		const children =
			entity.type === "way"
				? entity.nodes
				: entity.type === "relation"
					? entity.members.map((m) => m.ref)
					: [];
		for (const id of children) {
			if (!isNewId(id) && base.entity(id)) ids.add(id);
		}
	}
	return [...ids];
}

/** Moves the edits of `graph` onto the server's `current` versions (see the module comment). */
export function rebase(graph: Graph, current: readonly Current[]): Rebase {
	const base = graph.base();
	const server: Entity[] = [];
	const gone: EntityId[] = [];
	const edits: Entity[] = [];
	const reverts: EntityId[] = [];
	const conflicts: Conflict[] = [];
	let merged = 0;

	for (const theirs of current) {
		const { id } = theirs;
		const downloaded = base.entity(id);
		if (!downloaded) continue;
		const edited = graph.isEdited(id);
		const mine = graph.entity(id) ?? null;
		// The edits were made on this version already, or a later one (a conflict resolved).
		if (theirs.version <= (mine?.version ?? downloaded.version ?? 0)) continue;

		const conflict = (
			kind: ConflictKind,
			keys: readonly string[] = [],
			geometry = false,
		) =>
			conflicts.push({
				id,
				kind,
				base: downloaded,
				mine,
				theirs,
				keys,
				geometry,
			});

		if (!edited) {
			if (theirs.entity) server.push(theirs.entity);
			else if (usedByEdits(graph, id)) conflict("deleted-in-use");
			else gone.push(id);
			continue;
		}
		if (!mine) {
			if (theirs.entity) {
				conflict("deleted-by-me");
			} else {
				// Both deleted it: nothing left to send.
				gone.push(id);
				reverts.push(id);
				merged++;
			}
			continue;
		}
		if (!theirs.entity) {
			conflict("deleted-by-them");
			continue;
		}
		const result = merge3(downloaded, mine, theirs.entity);
		if (!result.merged) {
			conflict("both-edited", result.keys, result.geometry);
			continue;
		}
		server.push(theirs.entity);
		merged++;
		if (sameContent(result.merged, theirs.entity)) reverts.push(id);
		else edits.push({ ...result.merged, version: theirs.version });
	}

	const action: Action = (g) => {
		let next = g;
		for (const id of reverts) next = next.revert(id);
		for (const entity of edits) next = next.replace(entity);
		return next;
	};
	return { server, gone, action, merged, conflicts };
}

export type Resolution = "mine" | "theirs";

/** What resolving a conflict does, as a rebase without conflicts. */
export function resolveConflict(
	graph: Graph,
	conflict: Conflict,
	choice: Resolution,
): Rebase {
	const { id, theirs, base } = conflict;
	const mine = graph.entity(id) ?? null;
	const done = (
		server: readonly Entity[],
		gone: readonly EntityId[],
		action: Action,
	): Rebase => ({ server, gone, action, merged: 1, conflicts: [] });

	if (conflict.kind === "both-edited" && mine && theirs.entity) {
		// The side chosen wins what clashes; the other side's other changes are kept.
		const merged = merge3(base, mine, theirs.entity, choice).merged ?? mine;
		const entity = theirs.entity;
		return done([entity], [], (g) =>
			sameContent(merged, entity)
				? g.revert(id)
				: g.replace({ ...merged, version: theirs.version }),
		);
	}

	if (choice === "mine") {
		if (theirs.entity) {
			// Their version goes under the edit: a deletion or a modification of it is sent.
			return done([theirs.entity], [], (g) =>
				mine ? g.replace({ ...mine, version: theirs.version }) : g,
			);
		}
		// Deleted on the server: sending the entity with the deleted version restores it.
		const restored = mine ?? base;
		return done([], [], (g) =>
			g.replace({ ...restored, version: theirs.version }),
		);
	}

	if (theirs.entity) {
		const taken = theirs.entity;
		return done([taken], [], (g) => {
			let next = g.revert(id);
			// A way deleted with its nodes comes back with them.
			if (taken.type === "way") {
				for (const node of taken.nodes) {
					if (next.isEdited(node) && !next.entity(node))
						next = next.revert(node);
				}
			}
			return next;
		});
	}
	// Deleted on the server: gone from the data and from what uses it.
	// (`deleteEntities` needs it in the graph: put back an unedited one the server took away.)
	return done([], [id], (g) =>
		deleteEntities([id])(g.entity(id) ? g : g.replace(base)),
	);
}

/** The nodes and members of `entities` the graph doesn't have (to download with them). */
export function missingChildren(
	graph: Graph,
	entities: readonly Entity[],
): EntityId[] {
	const missing = new Set<EntityId>();
	for (const entity of entities) {
		const children =
			entity.type === "way"
				? entity.nodes
				: entity.type === "relation"
					? entity.members.map((m) => m.ref)
					: [];
		for (const id of children) {
			if (!graph.entity(id) && !graph.isEdited(id)) missing.add(id);
		}
	}
	return [...missing];
}

/** Whether an edited way holds the entity, or an edited relation lists it. */
function usedByEdits(graph: Graph, id: EntityId): boolean {
	const ways = entityType(id) === "node" ? graph.parentWays(id as NodeId) : [];
	return [...ways, ...graph.parentRelations(id)].some((parent) =>
		graph.isEdited(parent.id),
	);
}

interface Merge3 {
	readonly merged?: Entity;
	readonly keys: readonly string[];
	readonly geometry: boolean;
}

/**
 * Three-way merge of one entity: `base` the common version, `mine` and `theirs` its edits.
 * What both changed differently is a conflict (no `merged`), unless `prefer` names the side
 * that wins it: the other side's changes that don't clash are kept still (iD's `force_local`
 * and `force_remote`).
 */
export function merge3(
	base: Entity,
	mine: Entity,
	theirs: Entity,
	prefer?: Resolution,
): Merge3 {
	const winner = prefer === "theirs" ? theirs : mine;
	const tags = mergeTags(base.tags, mine.tags, theirs.tags);
	const keys = tags.conflicts;
	const merged: Record<string, string> = { ...tags.merged };
	for (const key of keys) {
		const value = winner.tags[key];
		if (value !== undefined) merged[key] = value;
	}

	let shape: Entity | undefined;
	switch (mine.type) {
		case "node": {
			const loc = pick(
				(base as Node).loc,
				mine.loc,
				(theirs as Node).loc,
				sameLoc,
			);
			shape = loc ? { ...mine, loc } : undefined;
			break;
		}
		case "way": {
			const nodes = pick(
				(base as Way).nodes,
				mine.nodes,
				(theirs as Way).nodes,
				sameList,
			);
			shape = nodes ? { ...mine, nodes } : undefined;
			break;
		}
		case "relation": {
			const members = mergeMembers(
				(base as Relation).members,
				mine.members,
				(theirs as Relation).members,
			);
			shape = members ? { ...mine, members } : undefined;
			break;
		}
	}
	const geometry = shape === undefined;
	if (!prefer && (geometry || keys.length > 0)) return { keys, geometry };
	// Geometry from the side preferred when both changed it.
	const result = {
		...(shape ?? { ...winner, id: mine.id }),
		tags: merged,
	} as Entity;
	return { merged: result, keys, geometry };
}

/** Each key from whichever side changed it; both changing it differently is a conflict. */
export function mergeTags(
	base: Tags,
	mine: Tags,
	theirs: Tags,
): { merged: Tags; conflicts: string[] } {
	const merged: Record<string, string> = {};
	const conflicts: string[] = [];
	const keys = new Set([
		...Object.keys(base),
		...Object.keys(mine),
		...Object.keys(theirs),
	]);
	for (const key of keys) {
		const [b, m, t] = [base[key], mine[key], theirs[key]];
		const value = m === t || t === b ? m : m === b ? t : null;
		if (value === null) conflicts.push(key);
		else if (value !== undefined) merged[key] = value;
	}
	return { merged, conflicts: conflicts.sort() };
}

/**
 * Members as their side changed them; when both did, the user's additions and removals are
 * made on the server's list, unless the user also reordered the members they kept.
 */
export function mergeMembers(
	base: readonly Member[],
	mine: readonly Member[],
	theirs: readonly Member[],
): readonly Member[] | undefined {
	const simple = pick(base, mine, theirs, sameMembers);
	if (simple) return simple;
	const key = (m: Member) => `${m.ref} ${m.role}`;
	const inBase = new Set(base.map(key));
	const inMine = new Set(mine.map(key));
	const added = mine.filter((m) => !inBase.has(key(m)));
	const removed = new Set(base.filter((m) => !inMine.has(key(m))).map(key));
	const kept = mine.filter((m) => inBase.has(key(m)));
	const keptOfBase = base.filter((m) => !removed.has(key(m)));
	if (!sameMembers(kept, keptOfBase)) return undefined;
	const result = theirs.filter((m) => !removed.has(key(m)));
	const present = new Set(result.map(key));
	for (const member of added) {
		if (!present.has(key(member))) result.push(member);
	}
	return result;
}

/** The value from the side that changed it from `base`; undefined when both did, differently. */
function pick<T>(
	base: T,
	mine: T,
	theirs: T,
	same: (a: T, b: T) => boolean,
): T | undefined {
	if (same(mine, theirs) || same(theirs, base)) return mine;
	if (same(mine, base)) return theirs;
	return undefined;
}

function sameLoc(a: Node["loc"], b: Node["loc"]): boolean {
	return a[0] === b[0] && a[1] === b[1];
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
	return a.length === b.length && a.every((x, i) => x === b[i]);
}

function sameMembers(a: readonly Member[], b: readonly Member[]): boolean {
	return (
		a.length === b.length &&
		a.every((m, i) => m.ref === b[i]?.ref && m.role === b[i]?.role)
	);
}
