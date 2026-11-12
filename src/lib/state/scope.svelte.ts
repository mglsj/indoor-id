/**
 * The building entered in building mode (B.0), or none in map mode. Holds the id while its
 * data loads (a link with `&building=`), and tells which features belong to it
 * (`edit/scope.ts`).
 */
import { inScope, type Scope, scopeOf } from "#lib/edit/scope.ts";
import type { EntityId, RelationId, WayId } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";

export type ScopeId = WayId | RelationId;

export class BuildingScope {
	/** The way or relation entered, null in map mode. */
	id = $state<ScopeId | null>(null);
	readonly #graph: () => Graph;
	/** The scope last worked out, for this graph and id. */
	#cache: { graph: Graph; id: ScopeId; scope: Scope | null } | null = null;

	/** `graph` gives the current graph (the editor's). */
	constructor(graph: () => Graph) {
		this.#graph = graph;
	}

	/** The scope entered, or null in map mode and while its data isn't loaded. */
	get current(): Scope | null {
		const { id } = this;
		if (!id) return null;
		const graph = this.#graph();
		const cache = this.#cache;
		if (cache?.graph === graph && cache.id === id) return cache.scope;
		const scope = scopeOf(graph, id);
		this.#cache = { graph, id, scope };
		return scope;
	}

	/**
	 * Enters a building, a building relation or a level outline; false (and nothing entered)
	 * when it is loaded and can't be entered. One not loaded yet is kept until it is.
	 */
	enter(id: ScopeId): boolean {
		const graph = this.#graph();
		if (graph.entity(id) && !scopeOf(graph, id)) return false;
		this.id = id;
		return true;
	}

	/** Back to map mode. */
	leave(): void {
		this.id = null;
	}

	/** Whether a feature belongs to the scope entered; false in map mode. */
	contains(id: EntityId): boolean {
		const scope = this.current;
		return scope ? inScope(this.#graph(), scope, id) : false;
	}
}
