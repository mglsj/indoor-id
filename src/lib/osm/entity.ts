import type { Tags } from "./tags.ts";

/**
 * OSM entities, as immutable plain objects. Ids carry the type as a prefix, like iD:
 * `n12` is node 12. Entities not uploaded yet have negative ids (`w-3`) and no version.
 */

export type NodeId = `n${number}`;
export type WayId = `w${number}`;
export type RelationId = `r${number}`;
export type EntityId = NodeId | WayId | RelationId;
export type EntityType = "node" | "way" | "relation";

/** Position as [longitude, latitude], the GeoJSON order. */
export type Loc = readonly [number, number];

interface EntityBase {
	readonly tags: Tags;
	/** Server version; undefined for entities created locally. */
	readonly version?: number;
	/** Who saved this version on the server, and when (ISO 8601); unknown for new entities. */
	readonly user?: string;
	readonly timestamp?: string;
}

export interface Node extends EntityBase {
	readonly type: "node";
	readonly id: NodeId;
	readonly loc: Loc;
}

export interface Way extends EntityBase {
	readonly type: "way";
	readonly id: WayId;
	readonly nodes: readonly NodeId[];
}

export interface Member {
	readonly ref: EntityId;
	readonly role: string;
}

export interface Relation extends EntityBase {
	readonly type: "relation";
	readonly id: RelationId;
	readonly members: readonly Member[];
}

export type Entity = Node | Way | Relation;

const PREFIXES = { node: "n", way: "w", relation: "r" } as const;
const TYPES = { n: "node", w: "way", r: "relation" } as const;

export function makeId(type: "node", osmId: number): NodeId;
export function makeId(type: "way", osmId: number): WayId;
export function makeId(type: "relation", osmId: number): RelationId;
export function makeId(type: EntityType, osmId: number): EntityId;
export function makeId(type: EntityType, osmId: number): EntityId {
	return `${PREFIXES[type]}${osmId}`;
}

export function entityType(id: EntityId): EntityType {
	return TYPES[id[0] as keyof typeof TYPES];
}

/** The numeric OSM id, negative for entities not uploaded yet. */
export function osmId(id: EntityId): number {
	return Number(id.slice(1));
}

export function isNewId(id: EntityId): boolean {
	return osmId(id) < 0;
}

/** Whether two versions of an entity have the same content (tags and geometry). */
export function sameContent(a: Entity, b: Entity): boolean {
	if (a.type !== b.type || !sameTags(a.tags, b.tags)) return false;
	switch (a.type) {
		case "node": {
			const loc = (b as Node).loc;
			return a.loc[0] === loc[0] && a.loc[1] === loc[1];
		}
		case "way": {
			const nodes = (b as Way).nodes;
			return (
				a.nodes.length === nodes.length &&
				a.nodes.every((n, i) => n === nodes[i])
			);
		}
		case "relation": {
			const members = (b as Relation).members;
			return (
				a.members.length === members.length &&
				a.members.every(
					(m, i) => m.ref === members[i]?.ref && m.role === members[i]?.role,
				)
			);
		}
	}
}

/** Whether two tag sets hold the same keys and values. */
export function sameTags(a: Tags, b: Tags): boolean {
	const keys = Object.keys(a);
	return (
		keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
	);
}
