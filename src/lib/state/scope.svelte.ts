/**
 * The building entered in building mode (B.0), or none in map mode. Holds the id while its
 * data loads (a link with `&building=`), and tells which features belong to it
 * (`edit/scope.ts`).
 */
import { inScope, isMapFeature, type Scope, scopeOf } from "#lib/edit/scope.ts";
import type { IndoorFeature } from "#lib/map/features.ts";
import type { EntityId, RelationId, WayId } from "#lib/osm/entity.ts";
import { extentOf } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import { Outlines } from "#lib/validation/outlines.ts";

export type ScopeId = WayId | RelationId;

export class BuildingScope {
	/** The way or relation entered, null in map mode. */
	id = $state<ScopeId | null>(null);
	readonly #graph: () => Graph;
	/** Buildings and level outlines by position, for `unscoped`. */
	readonly #outlines = new Outlines();
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

	/** Of these features, those in the scope entered; none in map mode. */
	members(ids: Iterable<EntityId>): Set<EntityId> {
		const scope = this.current;
		const inside = new Set<EntityId>();
		if (!scope) return inside;
		const graph = this.#graph();
		for (const id of ids) if (inScope(graph, scope, id)) inside.add(id);
		return inside;
	}

	/**
	 * Of these features, the indoor ones that no building or level outline holds (by the middle
	 * of their extent): map mode leaves them unfaded, since there is no building to enter.
	 */
	unscoped(features: Iterable<IndoorFeature>): Set<string> {
		this.#outlines.update(this.#graph());
		const loose = new Set<string>();
		for (const feature of features) {
			if (isMapFeature(feature.properties)) continue;
			const extent = extentOf(coordinates(feature.geometry));
			if (!extent) continue;
			const middle: [number, number] = [
				(extent.west + extent.east) / 2,
				(extent.south + extent.north) / 2,
			];
			const held = this.#outlines
				.at(middle)
				.some((o) => o.building || o.indoor === "level");
			if (!held) loose.add(feature.properties["@id"]);
		}
		return loose;
	}

	/** Whether the outline entered draws this way: locked in building mode. */
	isOutline(id: EntityId): boolean {
		const scope = this.current;
		return (
			scope !== null && (scope.id === id || scope.ways.includes(id as never))
		);
	}

	/** Whether a feature belongs to the scope entered; false in map mode. */
	contains(id: EntityId): boolean {
		const scope = this.current;
		return scope ? inScope(this.#graph(), scope, id) : false;
	}
}

/** Every position of a GeoJSON geometry. */
function coordinates(geometry: IndoorFeature["geometry"]): [number, number][] {
	switch (geometry.type) {
		case "Point":
			return [geometry.coordinates as [number, number]];
		case "LineString":
		case "MultiPoint":
			return geometry.coordinates as [number, number][];
		case "Polygon":
		case "MultiLineString":
			return geometry.coordinates.flat() as [number, number][];
		case "MultiPolygon":
			return geometry.coordinates.flat(2) as [number, number][];
		default:
			return [];
	}
}
