/**
 * The building entered in building mode (B.0), or none in map mode. Holds the id while its
 * data loads (a link with `&building=`), and tells which features belong to it
 * (`edit/scope.ts`).
 */
import { inScope, isMapFeature, type Scope, scopeOf } from "#lib/edit/scope.ts";
import type { IndoorFeature } from "#lib/map/features.ts";
import type { EntityId, NodeId, RelationId, WayId } from "#lib/osm/entity.ts";
import { extentOf } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import { Outlines } from "#lib/validation/outlines.ts";

export type ScopeId = WayId | RelationId;

export class BuildingScope {
	/** The way or relation entered, null in map mode. */
	id = $state<ScopeId | null>(null);
	/**
	 * Indoor data with no building around it entered ("Edit indoor here" where no building or
	 * level outline is, B.3): the indoor features that none holds, new ones included.
	 */
	loose = $state(false);
	/**
	 * Whether the outline entered is locked (B.4): drawn and snapped to, but not picked, and its
	 * nodes don't move, so indoor edits never move the shell by accident. "Edit outline"
	 * unlocks it for this visit.
	 */
	outlineLocked = $state(true);
	/** Whether what is outside the building entered is drawn, faded (B.2); hidden when off. */
	surroundings = $state(true);
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
		if (id !== this.id) this.outlineLocked = true;
		this.id = id;
		this.loose = false;
		return true;
	}

	/** Enters the indoor data that no building or level outline holds (B.3). */
	enterLoose(): void {
		this.id = null;
		this.loose = true;
	}

	/** Back to map mode. */
	leave(): void {
		this.id = null;
		this.loose = false;
		this.outlineLocked = true;
	}

	/**
	 * Building mode: a building, a level outline or the loose indoor data entered (a building
	 * from a link counts while its data loads).
	 */
	get active(): boolean {
		return this.loose || this.id !== null;
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
	 * of their extent): map mode leaves them unfaded, since there is no building to enter, and
	 * they are what the loose scope works on (with `entrances`, the entrances too).
	 */
	unscoped(
		features: Iterable<IndoorFeature>,
		{ entrances = false } = {},
	): Set<string> {
		this.#outlines.update(this.#graph());
		const loose = new Set<string>();
		for (const feature of features) {
			const { properties } = feature;
			if (
				entrances
					? properties["@kind"] === "building"
					: isMapFeature(properties)
			)
				continue;
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

	/** Whether the outline entered is locked and draws this way: a click doesn't pick it (B.4). */
	isLocked(id: EntityId): boolean {
		return this.outlineLocked && this.isOutline(id);
	}

	/**
	 * Whether moving these nodes would move the locked outline (B.4): one of them is a node of
	 * its ways (a room's corner on the facade, shared with the outline).
	 */
	movesOutline(nodes: Iterable<NodeId>): boolean {
		const scope = this.current;
		if (!scope || !this.outlineLocked) return false;
		const graph = this.#graph();
		const locked = new Set<NodeId>();
		for (const id of scope.ways) {
			const way = graph.entity(id);
			if (way?.type === "way") for (const node of way.nodes) locked.add(node);
		}
		for (const node of nodes) if (locked.has(node)) return true;
		return false;
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
