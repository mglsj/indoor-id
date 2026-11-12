/**
 * Building mode's scope (B.0): the building, or the `indoor=level` outline of indoor data with
 * no building around it, that the editor has entered, and which features belong to it.
 * Membership is by position only, never by relation membership: rooms belong to a building by
 * where they are and their `level` (Simple Indoor Tagging; the osm-simple3d-editor forum
 * thread, t/148767). Pure.
 */
import {
	type Entity,
	type EntityId,
	entityType,
	type Loc,
	type Relation,
	type Way,
	type WayId,
} from "#lib/osm/entity.ts";
import {
	distanceToLine,
	type Extent,
	extentOf,
	isClosedRing,
	type Point,
	pointInRing,
	wayLocs,
} from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import { entityExtent } from "#lib/osm/relations.ts";
import type { Tags } from "#lib/osm/tags.ts";

/** What was entered: a building, or a level outline standing in for one. */
export type ScopeKind = "building" | "level";

export interface Scope {
	/** The way or relation entered. */
	readonly id: EntityId;
	readonly kind: ScopeKind;
	/** Its outer rings (closed, first position repeated last). */
	readonly rings: readonly (readonly Loc[])[];
	/** The ways drawing them: the outline, locked in building mode. */
	readonly ways: readonly WayId[];
	readonly extent: Extent;
}

/** Metres within which a position counts as on a wall rather than inside or outside. */
export const ON_WALL = 0.05;

const isBuilding = (tags: Tags) =>
	tags.building !== undefined && tags.building !== "no";

/** The kind of scope an entity's tags make, if any. */
function kindOf(tags: Tags): ScopeKind | null {
	if (isBuilding(tags)) return "building";
	if (tags.indoor === "level") return "level";
	return null;
}

/** The closed member ways of a relation with one of these roles (any role when empty). */
function closedMembers(
	graph: Graph,
	relation: Relation,
	roles: readonly string[],
): Way[] {
	const ways: Way[] = [];
	for (const member of relation.members) {
		if (entityType(member.ref) !== "way") continue;
		if (roles.length > 0 && !roles.includes(member.role)) continue;
		const way = graph.entity(member.ref);
		if (way?.type === "way" && isClosedRing(way)) ways.push(way);
	}
	return ways;
}

/** The outer ways of what can be entered, or null when it can't be. */
function outerWays(graph: Graph, entity: Entity): Way[] | null {
	if (entity.type === "way") return isClosedRing(entity) ? [entity] : null;
	if (entity.type !== "relation") return null;
	if (entity.tags.type === "building") {
		// Its outline; parts only when the outline is missing.
		const outline = closedMembers(graph, entity, ["outline"]);
		return outline.length > 0
			? outline
			: closedMembers(graph, entity, ["part"]);
	}
	if (entity.tags.type === "multipolygon") {
		// Outers that aren't closed alone (chains of ways) aren't assembled yet.
		return closedMembers(graph, entity, ["outer", ""]);
	}
	return null;
}

/**
 * The scope of a building way or multipolygon, a `type=building` relation, or an
 * `indoor=level` outline; null for anything else, or what isn't loaded.
 */
export function scopeOf(graph: Graph, id: EntityId): Scope | null {
	const entity = graph.entity(id);
	if (!entity) return null;
	const kind =
		entity.type === "relation" && entity.tags.type === "building"
			? "building"
			: kindOf(entity.tags);
	if (!kind) return null;
	const ways = outerWays(graph, entity);
	if (!ways || ways.length === 0) return null;
	const drawn = ways.filter((way) => wayLocs(graph, way).length >= 4);
	const rings = drawn.map((way) => wayLocs(graph, way));
	const extent = extentOf(rings.flat());
	return extent && rings.length > 0
		? { id, kind, rings, ways: drawn.map((way) => way.id), extent }
		: null;
}

/** Whether a position is inside the scope, on a wall, or outside. */
function placeOf(scope: Scope, point: Point): "inside" | "wall" | "outside" {
	let inside = false;
	for (const ring of scope.rings) {
		if (distanceToLine(point, ring) <= ON_WALL) return "wall";
		if (pointInRing(point, ring)) inside = true;
	}
	return inside ? "inside" : "outside";
}

/** Whether the scope's extent holds a position (a quick test before the rings). */
function inExtent({ extent }: Scope, [x = 0, y = 0]: Point): boolean {
	const margin = 1e-6;
	return (
		x >= extent.west - margin &&
		x <= extent.east + margin &&
		y >= extent.south - margin &&
		y <= extent.north + margin
	);
}

/**
 * Whether a feature belongs to the scope, by position:
 * - the scope's own way or relation, and its outer ways;
 * - a point inside or on a wall (doors and entrances on the facade);
 * - a way with a node strictly inside, or with every node inside or on a wall (a level
 *   outline along the walls), so a neighbour's room against a shared wall is left out and a
 *   space across two buildings is in both;
 * - another building only when wholly inside or on the walls;
 * - a relation when one of its members is.
 */
export function inScope(graph: Graph, scope: Scope, id: EntityId): boolean {
	return contains(graph, scope, id, new Set());
}

function contains(
	graph: Graph,
	scope: Scope,
	id: EntityId,
	seen: Set<EntityId>,
): boolean {
	if (id === scope.id) return true;
	if (seen.has(id)) return false;
	seen.add(id);
	const entity = graph.entity(id);
	if (!entity) return false;
	switch (entity.type) {
		case "node":
			return inExtent(scope, entity.loc)
				? placeOf(scope, entity.loc) !== "outside"
				: false;
		case "way": {
			const locs = wayLocs(graph, entity);
			if (locs.length === 0 || !locs.some((loc) => inExtent(scope, loc)))
				return false;
			const places = locs.map((loc) => placeOf(scope, loc));
			const within = places.every((p) => p !== "outside");
			// Another building is in only when wholly inside: never a neighbour.
			if (isBuilding(entity.tags)) return within;
			return within || places.includes("inside");
		}
		case "relation":
			return entity.members.some((m) => contains(graph, scope, m.ref, seen));
	}
}

/** The area of a ring in square degrees, to pick the smallest of nested scopes. */
function ringArea(ring: readonly Loc[]): number {
	let sum = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i] as Loc;
		const [xj, yj] = ring[j] as Loc;
		sum += (xj + xi) * (yj - yi);
	}
	return Math.abs(sum / 2);
}

/**
 * What "Edit indoor here" enters at a position: the smallest building whose area holds it,
 * else the smallest `indoor=level` outline; null on the open map. Scans the loaded ways and
 * relations, so it is for a click, not for every pointer move.
 */
export function scopeAt(graph: Graph, loc: Loc): Scope | null {
	let best: { scope: Scope; area: number } | null = null;
	let bestLevel: { scope: Scope; area: number } | null = null;
	for (const entity of graph.entities()) {
		if (entity.type === "node") continue;
		const scope = scopeOf(graph, entity.id);
		if (!scope || !inExtent(scope, loc)) continue;
		const ring = scope.rings.find((r) => pointInRing(loc, r));
		if (!ring) continue;
		const area = ringArea(ring);
		if (scope.kind === "building") {
			if (!best || area < best.area) best = { scope, area };
		} else if (!bestLevel || area < bestLevel.area) {
			bestLevel = { scope, area };
		}
	}
	return best?.scope ?? bestLevel?.scope ?? null;
}

/**
 * The building (or level outline) a feature belongs to, for entering it from a click on the
 * feature in map mode: the scope at the middle of its extent, else at one of its nodes, that
 * holds it; null for indoor data outside any.
 */
export function scopeFor(graph: Graph, id: EntityId): Scope | null {
	const entity = graph.entity(id);
	if (!entity) return null;
	const locs: Loc[] = [];
	if (entity.type === "node") locs.push(entity.loc);
	else {
		const extent = entityExtent(graph, id);
		if (extent)
			locs.push([
				(extent.west + extent.east) / 2,
				(extent.south + extent.north) / 2,
			]);
		if (entity.type === "way") locs.push(...wayLocs(graph, entity));
	}
	for (const loc of locs) {
		const scope = scopeAt(graph, loc);
		if (scope && inScope(graph, scope, id)) return scope;
	}
	return null;
}

/**
 * Whether a drawn feature is one map mode works on (B.1): a building or building part, or an
 * entrance. Everything else is indoor, worked on inside a building. Reads the map features'
 * properties (`@kind`, tags), as the style's fading does.
 */
export function isMapFeature(properties: Record<string, unknown>): boolean {
	return (
		properties["@kind"] === "building" || properties.entrance !== undefined
	);
}
