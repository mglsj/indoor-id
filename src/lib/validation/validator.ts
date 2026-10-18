/**
 * Validation with a cache per entity: after an edit, only the entities it affected are checked
 * again (the changed entities, the nodes of changed ways before and after, and the parents and
 * members of what changed), so a big area costs nothing once checked.
 */
import type { Entity, EntityId } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { UpgradeRule } from "./upgrades.ts";
import { type Issue, validate } from "./validate.ts";

export type Check = typeof validate;

export class Validator {
	readonly #check: Check;
	#graph: Graph | null = null;
	#upgrades: readonly UpgradeRule[] | null = null;
	readonly #cache = new Map<EntityId, Issue[]>();

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
				cached = this.#check(graph, [id], upgrades);
				this.#cache.set(id, cached);
			}
			issues.push(...cached);
		}
		return issues;
	}

	/** Forgets what the change from the last graph (or rules) may have changed. */
	#follow(graph: Graph, upgrades: readonly UpgradeRule[]): void {
		const previous = this.#graph;
		this.#graph = graph;
		if (upgrades !== this.#upgrades || !previous) {
			this.#upgrades = upgrades;
			this.#cache.clear();
			return;
		}
		if (previous === graph) return;
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
