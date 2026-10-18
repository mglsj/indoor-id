/**
 * What the Relations and Members sections show, as iD's raw membership and member editors:
 * a feature's memberships, a relation's members, the relations a feature can be added to,
 * and the extent zoom-to fits.
 */
import {
	type Entity,
	type EntityId,
	type Loc,
	makeId,
	osmId,
	type Relation,
	type RelationId,
} from "./entity.ts";
import { type Extent, extentOf } from "./geometry.ts";
import type { Graph } from "./graph.ts";

/** One membership of a feature: the relation, and where and how the feature is in it. */
export interface Membership {
	readonly relation: Relation;
	readonly index: number;
	readonly role: string;
}

/**
 * The feature's memberships, one per place it holds in a relation, sorted by the relations'
 * labels (then ids); the relations added since the section opened come last, in that order.
 */
export function memberships(
	graph: Graph,
	id: EntityId,
	label: (relation: Relation) => string,
	recentlyAdded: readonly RelationId[] = [],
): Membership[] {
	const parents = graph.parentRelations(id);
	const sortKey = new Map(parents.map((r) => [r.id, `${label(r)}-${r.id}`]));
	const order = (r: Relation) => recentlyAdded.indexOf(r.id);
	const sorted = parents.sort((a, b) => {
		const [ra, rb] = [order(a), order(b)];
		if (ra >= 0 || rb >= 0) return ra - rb;
		return (sortKey.get(a.id) ?? "").localeCompare(
			sortKey.get(b.id) ?? "",
			undefined,
			{ numeric: true },
		);
	});
	return sorted.flatMap((relation) =>
		relation.members.flatMap((m, index) =>
			m.ref === id ? [{ relation, index, role: m.role }] : [],
		),
	);
}

/** One member of a relation; `entity` is undefined when it isn't loaded (incomplete). */
export interface MemberRow {
	readonly index: number;
	readonly ref: EntityId;
	readonly role: string;
	readonly entity: Entity | undefined;
}

export function memberRows(graph: Graph, relation: Relation): MemberRow[] {
	return relation.members.map((m, index) => ({
		index,
		ref: m.ref,
		role: m.role,
		entity: graph.entity(m.ref),
	}));
}

/** Whether every member of the relation is loaded. */
export function isComplete(graph: Graph, relation: Relation): boolean {
	return relation.members.every((m) => graph.entity(m.ref) !== undefined);
}

/** The relation typed by its id: `r123`, `123`, `relation/123` or a link ending so. */
export function relationIdIn(query: string): RelationId | null {
	const m = query.trim().match(/^(?:.*\/relation\/|relation\/|r)?(-?\d+)$/i);
	return m ? makeId("relation", Number(m[1])) : null;
}

export interface RelationChoice {
	readonly relation: Relation;
	/** What the list shows and filters on: the label, with the id when two are alike. */
	readonly value: string;
}

/**
 * The relations a feature can be added to, as iD's: a loaded relation typed by its id, or else
 * those in view whose label or id holds the query; relations of the ways the feature connects
 * to come first, then the newest.
 */
export function nearbyRelations(
	graph: Graph,
	id: EntityId,
	query: string,
	{
		inView,
		label,
	}: {
		inView: (relation: Relation) => boolean;
		label: (relation: Relation) => string;
	},
): RelationChoice[] {
	const typed = relationIdIn(query);
	const explicit = typed ? graph.entity(typed) : undefined;
	if (explicit?.type === "relation" && explicit.id !== id) {
		return [{ relation: explicit, value: `${label(explicit)} ${explicit.id}` }];
	}

	const q = query.toLowerCase();
	const found: { relation: Relation; value: string }[] = [];
	for (const entity of graph.entities()) {
		if (entity.type !== "relation" || entity.id === id || !inView(entity)) {
			continue;
		}
		const value = label(entity);
		if (q && !`${value} ${entity.id}`.toLowerCase().includes(q)) continue;
		found.push({ relation: entity, value });
	}

	const connected = connectedRelations(graph, id);
	found.sort((a, b) => {
		const ca = connected.has(a.relation.id);
		const cb = connected.has(b.relation.id);
		if (ca !== cb) return ca ? -1 : 1;
		return creationOrder(a.relation.id, b.relation.id);
	});

	// Two relations alike are told apart by their ids (iD #2891).
	const counts = new Map<string, number>();
	for (const { value } of found)
		counts.set(value, (counts.get(value) ?? 0) + 1);
	return found.map(({ relation, value }) => ({
		relation,
		value: (counts.get(value) ?? 0) > 1 ? `${value} ${relation.id}` : value,
	}));
}

/** New relations first (the last created first), then the newest on the server. */
function creationOrder(a: RelationId, b: RelationId): number {
	const [ia, ib] = [osmId(a), osmId(b)];
	return ia < 0 || ib < 0 ? ia - ib : ib - ia;
}

/** Relations of the other ways the feature's nodes are on. */
function connectedRelations(graph: Graph, id: EntityId): Set<RelationId> {
	const entity = graph.entity(id);
	const ways = new Set<EntityId>();
	if (entity?.type === "node") {
		for (const way of graph.parentWays(entity.id)) ways.add(way.id);
	} else if (entity?.type === "way") {
		for (const node of entity.nodes) {
			for (const way of graph.parentWays(node)) {
				if (way.id !== id) ways.add(way.id);
			}
		}
	}
	const relations = new Set<RelationId>();
	for (const way of ways) {
		for (const r of graph.parentRelations(way)) relations.add(r.id);
	}
	return relations;
}

/** The extent of what is loaded of an entity (members of members included), or null. */
export function entityExtent(graph: Graph, id: EntityId): Extent | null {
	const locs: Loc[] = [];
	const seen = new Set<EntityId>();
	const visit = (ref: EntityId) => {
		if (seen.has(ref)) return;
		seen.add(ref);
		const entity = graph.entity(ref);
		switch (entity?.type) {
			case "node":
				locs.push(entity.loc);
				break;
			case "way":
				for (const node of entity.nodes) visit(node);
				break;
			case "relation":
				for (const m of entity.members) visit(m.ref);
				break;
		}
	};
	visit(id);
	return extentOf(locs);
}
