import { Map as PersistentMap } from "immutable";
import {
	type Entity,
	type EntityId,
	type EntityType,
	isNewId,
	makeId,
	type Node,
	type NodeId,
	osmId,
	type Relation,
	type RelationId,
	sameContent,
	type Way,
	type WayId,
} from "./entity.ts";

type ParentIndex = ReadonlyMap<EntityId, ReadonlySet<EntityId>>;

/** Server data shared by every graph derived from it, with lazily built parent indexes. */
class BaseData {
	#parentWays?: ParentIndex;
	#parentRelations?: ParentIndex;

	constructor(readonly entities: ReadonlyMap<EntityId, Entity>) {}

	get parentWays(): ParentIndex {
		this.#parentWays ??= buildParentWays(this.entities.values());
		return this.#parentWays;
	}

	get parentRelations(): ParentIndex {
		this.#parentRelations ??= buildParentRelations(this.entities.values());
		return this.#parentRelations;
	}
}

export interface Changes {
	readonly created: readonly Entity[];
	readonly modified: readonly Entity[];
	/** The base version of each deleted entity. */
	readonly deleted: readonly Entity[];
}

/**
 * An immutable set of OSM entities: the server data (base) plus local edits. Every change
 * returns a new graph, so history is a list of graphs and undo never has to revert anything.
 * An action changing many entities runs on one copy instead (`update`, iD's unfrozen graph).
 */
export class Graph {
	readonly #base: BaseData;
	/**
	 * Local edits (null: deleted), a persistent map: each step of a history shares all but what
	 * it changed. Only ever changed in place by a graph that `update` hasn't given out yet.
	 */
	#local: LocalEdits;
	#nextId: number;
	/** False while `update` runs an action on this copy: changes are then made in place. */
	#frozen = true;
	/**
	 * Parent indexes of the local edits. A graph made by an edit shares its parent's and adds
	 * to them: they may hold links no longer true, so lookups check that a parent still holds
	 * the child.
	 */
	#localParentWays?: Map<EntityId, Set<EntityId>>;
	#localParentRelations?: Map<EntityId, Set<EntityId>>;
	/** The graph an edit (`replace`, `remove`, `update`) made this one from, and the ids it set. */
	#parent?: Graph;
	#touched?: Set<EntityId>;
	/** The number of local changes, once counted. */
	#count?: number;

	private constructor(base: BaseData, local: LocalEdits, nextId: number) {
		this.#base = base;
		this.#local = local;
		this.#nextId = nextId;
	}

	static fromEntities(entities: Iterable<Entity>): Graph {
		const map = new Map<EntityId, Entity>();
		let nextId = -1;
		for (const entity of entities) {
			map.set(entity.id, entity);
			nextId = Math.min(nextId, osmId(entity.id) - 1);
		}
		return new Graph(new BaseData(map), NO_EDITS, nextId);
	}

	entity(id: EntityId): Entity | undefined {
		const local = this.#local.get(id);
		if (local !== undefined) return local ?? undefined;
		return this.#base.entities.get(id);
	}

	/** A way's nodes in order, leaving out those not downloaded. */
	childNodes(way: Way): Node[] {
		const nodes: Node[] = [];
		for (const id of way.nodes) {
			const node = this.entity(id);
			if (node?.type === "node") nodes.push(node);
		}
		return nodes;
	}

	/** Every entity currently in the graph. */
	*entities(): Generator<Entity> {
		for (const [id, entity] of this.#base.entities) {
			if (!this.#local.has(id)) yield entity;
		}
		for (const entity of this.#local.values()) {
			if (entity) yield entity;
		}
	}

	/**
	 * Runs an action on one copy of this graph, whose `replace` and `remove` change it in place
	 * rather than copying every local edit each time (deleting 1,000 rooms was quadratic). The
	 * graph returned is immutable again; this one is left as it was.
	 */
	update(action: (graph: Graph) => Graph): Graph {
		const draft = this.#child(this.#local.asMutable(), this.#nextId, new Set());
		draft.#frozen = false;
		const result = action(draft);
		draft.#frozen = true;
		draft.#local = draft.#local.asImmutable();
		result.#frozen = true;
		result.#local = result.#local.asImmutable();
		return result;
	}

	/** Adds or updates an entity. */
	replace(entity: Entity): Graph {
		const nextId = isNewId(entity.id)
			? Math.min(this.#nextId, osmId(entity.id) - 1)
			: this.#nextId;
		if (!this.#frozen) {
			this.#local = this.#local.set(entity.id, entity);
			this.#nextId = nextId;
			this.#touched?.add(entity.id);
			this.#link(entity);
			return this;
		}
		const child = this.#child(
			this.#local.set(entity.id, entity),
			nextId,
			new Set([entity.id]),
		);
		child.#link(entity);
		return child;
	}

	remove(id: EntityId): Graph {
		if (!this.#frozen) {
			this.#local = this.#local.set(id, null);
			this.#touched?.add(id);
			return this;
		}
		return this.#child(this.#local.set(id, null), this.#nextId, new Set([id]));
	}

	/** A graph made from this one by an edit setting `touched`. */
	#child(local: LocalEdits, nextId: number, touched: Set<EntityId>): Graph {
		const child = new Graph(this.#base, local, nextId);
		child.#parent = this;
		child.#touched = touched;
		child.#localParentWays = this.#localParentWays;
		child.#localParentRelations = this.#localParentRelations;
		return child;
	}

	/** Adds an entity's links to the parent indexes, if built (links are only ever added). */
	#link(entity: Entity): void {
		if (entity.type === "way" && this.#localParentWays) {
			for (const node of entity.nodes) {
				addTo(this.#localParentWays, node, entity.id);
			}
		}
		if (entity.type === "relation" && this.#localParentRelations) {
			for (const m of entity.members) {
				addTo(this.#localParentRelations, m.ref, entity.id);
			}
		}
	}

	/**
	 * An id that no entity of this graph, or of the graphs it derives from, has used, and that
	 * no other call gives again (only the counter moves: the entities stay as they were).
	 */
	newId(type: "node"): NodeId;
	newId(type: "way"): WayId;
	newId(type: "relation"): RelationId;
	newId(type: EntityType): EntityId;
	newId(type: EntityType): EntityId {
		const id = makeId(type, this.#nextId);
		this.#nextId--;
		return id;
	}

	/** Whether the entity was created, modified or deleted locally. */
	isEdited(id: EntityId): boolean {
		return this.#local.has(id);
	}

	/** This graph's server data with `entities` added or replaced, without local edits. */
	withBaseEntities(entities: Iterable<Entity>): Graph {
		const map = new Map(this.#base.entities);
		let nextId = this.#nextId;
		for (const entity of entities) {
			map.set(entity.id, entity);
			nextId = Math.min(nextId, osmId(entity.id) - 1);
		}
		return new Graph(new BaseData(map), NO_EDITS, nextId);
	}

	/** The same local edits, applied on the server data of `base`. */
	rebaseOnto(base: Graph): Graph {
		return new Graph(
			base.#base,
			this.#local,
			Math.min(this.#nextId, base.#nextId),
		);
	}

	/** The graph of server data, without local edits. */
	base(): Graph {
		return new Graph(this.#base, NO_EDITS, this.#nextId);
	}

	parentWays(id: NodeId): Way[] {
		return this.#parents(
			id,
			this.#base.parentWays,
			this.#localIndexes().ways,
		).filter((e): e is Way => e.type === "way" && e.nodes.includes(id));
	}

	parentRelations(id: EntityId): Relation[] {
		return this.#parents(
			id,
			this.#base.parentRelations,
			this.#localIndexes().relations,
		).filter(
			(e): e is Relation =>
				e.type === "relation" && e.members.some((m) => m.ref === id),
		);
	}

	/**
	 * The entities added, changed or removed since `other` (by identity: an entity put back as
	 * it was isn't listed). Cheap between graphs of one history; after a download (another
	 * server data) every entity is compared.
	 */
	changedSince(other: Graph): Set<EntityId> {
		// Steps of one history: only what the edits between them set (either way, for undo).
		if (this.#base === other.#base) {
			const touched = this.#touchedSince(other) ?? other.#touchedSince(this);
			if (touched) {
				const changed = new Set<EntityId>();
				for (const id of touched) {
					if (this.entity(id) !== other.entity(id)) changed.add(id);
				}
				return changed;
			}
		}
		const changed = new Set<EntityId>();
		const check = (id: EntityId) => {
			if (this.entity(id) !== other.entity(id)) changed.add(id);
		};
		if (this.#base !== other.#base) {
			for (const id of this.#base.entities.keys()) check(id);
			for (const id of other.#base.entities.keys()) check(id);
		}
		for (const id of this.#local.keys()) check(id);
		for (const id of other.#local.keys()) check(id);
		return changed;
	}

	/** Local edits compared to the server data. */
	changes(): Changes {
		const created: Entity[] = [];
		const modified: Entity[] = [];
		const deleted: Entity[] = [];
		for (const [id, entity] of this.#local) {
			const base = this.#base.entities.get(id);
			if (entity && !base) created.push(entity);
			else if (entity && base && !sameContent(entity, base))
				modified.push(entity);
			else if (!entity && base) deleted.push(base);
		}
		return { created, modified, deleted };
	}

	hasChanges(): boolean {
		return this.changeCount() > 0;
	}

	/**
	 * How many entities were created, modified or deleted (as `changes()` lists them), counted
	 * from the graph this one was made from when it has counted, so an edit costs what it set.
	 */
	changeCount(): number {
		if (this.#count !== undefined) return this.#count;
		const parent = this.#parent;
		let count = 0;
		if (parent && parent.#count !== undefined && this.#touched) {
			count = parent.#count;
			for (const id of this.#touched) {
				count += this.#isChange(id) - parent.#isChange(id);
			}
		} else {
			for (const id of this.#local.keys()) count += this.#isChange(id);
		}
		// A graph `update` is still changing counts again later.
		if (this.#frozen) this.#count = count;
		return count;
	}

	/** 1 when the entity is a local change (created, modified or deleted), else 0. */
	#isChange(id: EntityId): number {
		const local = this.#local.get(id);
		if (local === undefined) return 0;
		const base = this.#base.entities.get(id);
		if (local === null) return base ? 1 : 0;
		return !base || !sameContent(local, base) ? 1 : 0;
	}

	/**
	 * The ids set by the edits that made this graph from `ancestor`, when it is one of the last
	 * graphs this one comes from; null otherwise.
	 */
	#touchedSince(ancestor: Graph): Set<EntityId> | null {
		const ids = new Set<EntityId>();
		let graph: Graph | undefined = this;
		for (let step = 0; graph && step <= MAX_CHAIN; step++) {
			if (graph === ancestor) return ids;
			if (!graph.#touched) return null;
			for (const id of graph.#touched) ids.add(id);
			graph = graph.#parent;
		}
		return null;
	}

	#parents(id: EntityId, base: ParentIndex, local: ParentIndex): Entity[] {
		const ids = new Set([...(base.get(id) ?? []), ...(local.get(id) ?? [])]);
		const parents: Entity[] = [];
		for (const parentId of ids) {
			const parent = this.entity(parentId);
			if (parent) parents.push(parent);
		}
		return parents;
	}

	#localIndexes(): {
		ways: Map<EntityId, Set<EntityId>>;
		relations: Map<EntityId, Set<EntityId>>;
	} {
		if (!this.#localParentWays || !this.#localParentRelations) {
			const entities = [...this.#local.values()].filter((e) => e !== null);
			this.#localParentWays = buildParentWays(entities);
			this.#localParentRelations = buildParentRelations(entities);
		}
		return {
			ways: this.#localParentWays,
			relations: this.#localParentRelations,
		};
	}
}

type LocalEdits = PersistentMap<EntityId, Entity | null>;

/** How many steps back `changedSince` follows edits before comparing whole graphs. */
const MAX_CHAIN = 64;

const NO_EDITS: LocalEdits = PersistentMap();

function buildParentWays(
	entities: Iterable<Entity>,
): Map<EntityId, Set<EntityId>> {
	const index = new Map<EntityId, Set<EntityId>>();
	for (const entity of entities) {
		if (entity.type !== "way") continue;
		for (const node of entity.nodes) addTo(index, node, entity.id);
	}
	return index;
}

function buildParentRelations(
	entities: Iterable<Entity>,
): Map<EntityId, Set<EntityId>> {
	const index = new Map<EntityId, Set<EntityId>>();
	for (const entity of entities) {
		if (entity.type !== "relation") continue;
		for (const member of entity.members) addTo(index, member.ref, entity.id);
	}
	return index;
}

function addTo(
	index: Map<EntityId, Set<EntityId>>,
	key: EntityId,
	value: EntityId,
) {
	let set = index.get(key);
	if (!set) {
		set = new Set();
		index.set(key, set);
	}
	set.add(value);
}

/** Returns the entity, or throws if the graph doesn't have it. */
export function getEntity<T extends Entity["type"]>(
	graph: Graph,
	id: EntityId,
	type: T,
): Extract<Entity, { type: T }> {
	const entity = graph.entity(id);
	if (entity?.type !== type) throw new Error(`Unknown ${type} ${id}`);
	return entity as Extract<Entity, { type: T }>;
}
