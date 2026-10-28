/**
 * Validation with a cache per entity: after an edit, only the entities it affected are checked
 * again (the changed entities, the nodes of changed ways before and after, the parents and
 * members of what changed, and what lies where a building or indoor outline changed), so a big
 * area costs nothing once checked.
 */
import type { Entity, EntityId } from "#lib/osm/entity.ts";
import {
	type Extent,
	extentOf,
	extentsIntersect,
	wayLocs,
} from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import { Outlines } from "./outlines.ts";
import type { UpgradeRule } from "./upgrades.ts";
import { type Issue, validate } from "./validate.ts";

export type Check = typeof validate;

export class Validator {
	readonly #check: Check;
	#graph: Graph | null = null;
	#upgrades: readonly UpgradeRule[] | null = null;
	readonly #cache = new Map<EntityId, Issue[]>();
	readonly #outlines = new Outlines();

	constructor(check: Check = validate) {
		this.#check = check;
	}

	/** The issues of `ids` in `graph`, as `validate` gives them. */
	issues(
		graph: Graph,
		ids: Iterable<EntityId>,
		upgrades: readonly UpgradeRule[],
	): Issue[] {
		this.#follow(graph, upgrades);
		const issues: Issue[] = [];
		for (const id of ids) {
			let cached = this.#cache.get(id);
			if (!cached) {
				cached = this.#check(graph, [id], upgrades, this.#outlines);
				this.#cache.set(id, cached);
			}
			issues.push(...cached);
		}
		return issues;
	}

	/** Forgets the cached issues of what lies in or near the extents of changed outlines. */
	#forgetWithin(graph: Graph, extents: readonly Extent[]): void {
		if (extents.length === 0) return;
		const areas = extents.map((e) => ({
			west: e.west - MARGIN,
			south: e.south - MARGIN,
			east: e.east + MARGIN,
			north: e.north + MARGIN,
		}));
		for (const id of this.#cache.keys()) {
			const entity = graph.entity(id);
			const extent = entity && extentOfEntity(graph, entity);
			if (!extent || areas.some((a) => extentsIntersect(a, extent))) {
				this.#cache.delete(id);
			}
		}
	}

	/** Forgets what the change from the last graph (or rules) may have changed. */
	#follow(graph: Graph, upgrades: readonly UpgradeRule[]): void {
		const previous = this.#graph;
		this.#graph = graph;
		const moved = this.#outlines.update(graph);
		if (upgrades !== this.#upgrades || !previous) {
			this.#upgrades = upgrades;
			this.#cache.clear();
			return;
		}
		if (previous === graph) return;
		this.#forgetWithin(graph, moved);
		for (const id of graph.changedSince(previous)) {
			for (const affected of [
				...related(previous, id),
				...related(graph, id),
			]) {
				this.#cache.delete(affected);
			}
		}
	}
}

/** A little more than the checks' 0.5 m, in degrees, around changed outlines. */
const MARGIN = 0.00002;

/** The extent of an entity, for the spatial checks (relations have none). */
function extentOfEntity(graph: Graph, entity: Entity): Extent | null {
	if (entity.type === "node") return extentOf([entity.loc]);
	if (entity.type === "way") return extentOf(wayLocs(graph, entity));
	return null;
}

/** An entity, its parents and its children (a way's nodes, a relation's members) in `graph`. */
function* related(graph: Graph, id: EntityId): Generator<EntityId> {
	yield id;
	const entity: Entity | undefined = graph.entity(id);
	if (!entity) return;
	if (entity.type === "way") yield* entity.nodes;
	if (entity.type === "relation") for (const m of entity.members) yield m.ref;
	if (entity.type === "node") {
		for (const parent of graph.parentWays(entity.id)) yield parent.id;
	}
	for (const parent of graph.parentRelations(id)) yield parent.id;
}
