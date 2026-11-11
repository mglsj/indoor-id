/**
 * Unmapped floor (P5.4a, from osm-simple3d-editor): the part of a level that no room,
 * corridor or area covers is empty, and selectable. A click there finds the level's outline
 * (its `indoor=level`, else the building) minus the indoor spaces drawn on that level, as
 * connected pieces, and takes the piece under the click (`unmappedFloorAt`). Mapping it
 * (`mapFloor`) draws that piece as a new feature on the level, `indoor=area` unless its tags
 * say otherwise, through the nodes of its neighbours: corners on the same spot are the same
 * node, neighbours' corners along its sides are its corners too, and where a room's side
 * crosses another's a new node goes into both (not into building outlines, as Split).
 */
import type { Geometry, Position } from "geojson";
import { difference, type Geom } from "polyclip-ts";
import type { IndoorFeature } from "#lib/map/features.ts";
import type {
	Entity,
	EntityId,
	Loc,
	NodeId,
	Way,
	WayId,
} from "#lib/osm/entity.ts";
import {
	distanceToSegment,
	type Extent,
	extentOf,
	extentsIntersect,
	pointInPolygon,
} from "#lib/osm/geometry.ts";
import { type Graph, getEntity } from "#lib/osm/graph.ts";
import type { Tags } from "#lib/osm/tags.ts";

export interface UnmappedFloor {
	/** The level it is on. */
	readonly level: number;
	/** Where it was clicked, to find it again after an edit. */
	readonly at: Loc;
	/** The `indoor=level` outline or building it is the empty part of. */
	readonly container: EntityId;
	/** The features cut out of the container (the spaces on the level around it). */
	readonly cutOut: readonly EntityId[];
	/** Its outline then its holes, each closed, as [lon, lat]. */
	readonly rings: readonly (readonly Loc[])[];
	/** Its area on the ground, in square metres. */
	readonly area: number;
}

/** The `indoor` values whose areas cover floor: what is left is unmapped. */
const COVERING = new Set(["room", "area", "corridor", "wall", "column"]);
/** Pieces smaller than this (square metres) are gaps between drawn rooms, not floor. */
export const MIN_FLOOR_AREA = 0.5;
/** A corner this close (metres) to a node is that node. */
const SAME_SPOT = 0.01;

type Polygon = readonly (readonly Loc[])[];

/** A feature's polygons ([outer, ...holes] each), or none for points and lines. */
function polygonsOf(geometry: Geometry): Polygon[] {
	const rings = (coordinates: Position[][]): Polygon =>
		coordinates.map((ring) => ring.map(([lon = 0, lat = 0]) => [lon, lat]));
	if (geometry.type === "Polygon") return [rings(geometry.coordinates)];
	if (geometry.type === "MultiPolygon") return geometry.coordinates.map(rings);
	return [];
}

function onLevel(feature: IndoorFeature, level: number): boolean {
	return feature.properties["@lv"].includes(`;${String(level)};`);
}

/** Square metres inside a ring, flat around its first corner. */
function ringArea(ring: readonly Loc[]): number {
	const [origin] = ring;
	if (!origin) return 0;
	const scale = Math.cos((origin[1] * Math.PI) / 180);
	const metres = 111_195;
	let sum = 0;
	for (let i = 1; i < ring.length; i++) {
		const [x0, y0] = ring[i - 1] as Loc;
		const [x1, y1] = ring[i] as Loc;
		sum +=
			(x0 - origin[0]) * scale * (y1 - origin[1]) -
			(x1 - origin[0]) * scale * (y0 - origin[1]);
	}
	return (Math.abs(sum) / 2) * metres * metres;
}

function polygonArea([outer, ...holes]: Polygon): number {
	return (
		(outer ? ringArea(outer) : 0) -
		holes.reduce((sum, hole) => sum + ringArea(hole), 0)
	);
}

function extentOfPolygons(polygons: readonly Polygon[]): Extent | null {
	return extentOf(polygons.flatMap((p) => p[0] ?? []));
}

/**
 * The container a click on empty floor is in: the smallest `indoor=level` outline on the
 * level holding it, else the smallest building drawn on the level.
 */
export function containerAt(
	features: readonly IndoorFeature[],
	at: Loc,
	level: number,
): { feature: IndoorFeature; polygons: Polygon[] } | null {
	let best: { feature: IndoorFeature; polygons: Polygon[] } | null = null;
	let bestRank = Number.POSITIVE_INFINITY;
	for (const feature of features) {
		const tags = feature.properties;
		const isLevel = tags.indoor === "level" && onLevel(feature, level);
		const isBuilding =
			!isLevel &&
			tags.indoor === undefined &&
			tags.building !== undefined &&
			tags.building !== "no" &&
			(feature.properties["@lv"] === "*" || onLevel(feature, level));
		if (!isLevel && !isBuilding) continue;
		const polygons = polygonsOf(feature.geometry);
		const holding = polygons.find((p) => pointInPolygon(at, p));
		if (!holding) continue;
		// Any level outline before any building, then the smallest.
		const rank = (isLevel ? 0 : 1e12) + polygonArea(holding);
		if (rank < bestRank) {
			best = { feature, polygons };
			bestRank = rank;
		}
	}
	return best;
}

/**
 * The unmapped floor under `at` on `level`, from the map's features: the piece of its level
 * outline (or building) that no room, corridor, area, wall or column on the level covers.
 * Null outside any outline, inside a covered part, or in a gap under `MIN_FLOOR_AREA`.
 */
export function unmappedFloorAt(
	features: Iterable<IndoorFeature>,
	at: Loc,
	level: number,
): UnmappedFloor | null {
	const all = [...features];
	const container = containerAt(all, at, level);
	if (!container) return null;
	const extent = extentOfPolygons(container.polygons);
	if (!extent) return null;
	const containerId = container.feature.properties["@id"] as EntityId;
	const cutOut: EntityId[] = [];
	const covering: Geom[] = [];
	for (const feature of all) {
		const tags = feature.properties;
		const id = tags["@id"] as EntityId;
		if (id === containerId || !COVERING.has(tags.indoor ?? "")) continue;
		if (!onLevel(feature, level)) continue;
		const polygons = polygonsOf(feature.geometry);
		const own = extentOfPolygons(polygons);
		if (!own || !extentsIntersect(own, extent)) continue;
		cutOut.push(id);
		covering.push(polygons as Geom);
	}
	const pieces = difference(container.polygons as Geom, ...covering);
	for (const piece of pieces) {
		const polygon = piece as unknown as Polygon;
		if (!pointInPolygon(at, polygon)) continue;
		const area = polygonArea(polygon);
		if (area < MIN_FLOOR_AREA) return null;
		return { level, at, container: containerId, cutOut, rings: polygon, area };
	}
	return null;
}

/** The ways of a feature: itself, or a relation's member ways. */
function waysOf(graph: Graph, id: EntityId): Way[] {
	const entity: Entity | undefined = graph.entity(id);
	if (entity?.type === "way") return [entity];
	if (entity?.type !== "relation") return [];
	return entity.members.flatMap((m) => {
		const member = graph.entity(m.ref);
		return member?.type === "way" ? [member] : [];
	});
}

/** Whether a way outlines a building (or is part of one), which mapping leaves alone. */
function isBuildingWay(graph: Graph, way: Way): boolean {
	const building = (tags: Tags) =>
		tags.building !== undefined && tags.building !== "no";
	return (
		building(way.tags) ||
		graph.parentRelations(way.id).some((r) => building(r.tags))
	);
}

/**
 * Draws an unmapped floor as a feature with `tags` (plus `level`, and `indoor=area` unless
 * they set `indoor`), sharing nodes with its neighbours: a way, or a multipolygon when it has
 * holes (a hole that is exactly one room is that room's way). Returns the graph and the new
 * feature to select.
 */
export function mapFloor(
	graph: Graph,
	floor: UnmappedFloor,
	tags: Tags,
): { graph: Graph; select: EntityId[] } {
	let g = graph;
	const ways = [floor.container, ...floor.cutOut].flatMap((id) =>
		waysOf(graph, id),
	);
	const nodes = new Map<NodeId, Loc>();
	for (const way of ways) {
		for (const id of way.nodes) {
			const node = graph.entity(id);
			if (node?.type === "node") nodes.set(id, node.loc);
		}
	}
	const exact = new Map<string, NodeId>();
	for (const [id, loc] of nodes) exact.set(`${loc[0]},${loc[1]}`, id);

	/** The node at a corner: one of the neighbours' on the spot, else a new one. */
	const added: { id: NodeId; loc: Loc }[] = [];
	function nodeAt(loc: Loc): NodeId {
		const same = exact.get(`${loc[0]},${loc[1]}`);
		if (same) return same;
		for (const [id, at] of nodes) {
			if (distanceToSegment(loc, at, at) < SAME_SPOT) return id;
		}
		for (const node of added) {
			if (distanceToSegment(loc, node.loc, node.loc) < SAME_SPOT)
				return node.id;
		}
		const id = g.newId("node");
		g = g.replace({ type: "node", id, loc, tags: {} });
		added.push({ id, loc });
		return id;
	}

	const rings: NodeId[][] = [];
	for (const ring of floor.rings) {
		const corners = ring.slice(0, -1).map(nodeAt);
		const open = withNodesOnSides(g, corners, nodes);
		const distinct = open.filter((id, i) => id !== open.at(i - 1));
		if (new Set(distinct).size < 3) continue;
		rings.push(distinct);
	}

	// New corners go into the sides of the indoor ways they lie on: a room's wall, the level.
	if (added.length > 0) {
		for (const way of ways) {
			if (isBuildingWay(g, way)) continue;
			const current = getEntity(g, way.id, "way");
			const next = withNewNodes(g, current.nodes, added);
			if (next.length !== current.nodes.length)
				g = g.replace({ ...current, nodes: next });
		}
	}

	const level = String(floor.level);
	const { area: _area, ...rest } = tags;
	const own: Tags = {
		...(tags.area === "yes" ? rest : tags),
		indoor: tags.indoor ?? "area",
		level,
	};

	const [outer, ...holes] = rings;
	if (!outer) return { graph, select: [] };
	if (holes.length === 0) {
		const id = g.newId("way");
		g = g.replace({
			type: "way",
			id,
			nodes: [...outer, outer[0] as NodeId],
			tags: own,
		});
		return { graph: g, select: [id] };
	}
	const members: { ref: WayId; role: string }[] = [];
	const outerId = g.newId("way");
	g = g.replace({
		type: "way",
		id: outerId,
		nodes: [...outer, outer[0] as NodeId],
		tags: {},
	});
	members.push({ ref: outerId, role: "outer" });
	for (const hole of holes) {
		const same = ways.find((w) => sameRing(getEntity(g, w.id, "way"), hole));
		let ref = same?.id;
		if (!ref) {
			ref = g.newId("way");
			g = g.replace({
				type: "way",
				id: ref,
				nodes: [...hole, hole[0] as NodeId],
				tags: {},
			});
		}
		members.push({ ref, role: "inner" });
	}
	const relation = g.newId("relation");
	g = g.replace({
		type: "relation",
		id: relation,
		members,
		tags: { ...own, type: "multipolygon" },
	});
	return { graph: g, select: [relation] };
}

/** Whether a closed way goes round exactly these corners. */
function sameRing(way: Way, corners: readonly NodeId[]): boolean {
	const open = way.nodes.slice(0, -1);
	if (way.nodes[0] !== way.nodes.at(-1) || open.length !== corners.length)
		return false;
	const set = new Set(open);
	return corners.every((c) => set.has(c));
}

/**
 * A ring's corners with the neighbours' nodes that lie along its sides put in between, in
 * order: a straight wall past two rooms passes the corner they share.
 */
function withNodesOnSides(
	graph: Graph,
	corners: readonly NodeId[],
	nodes: ReadonlyMap<NodeId, Loc>,
): NodeId[] {
	const locOf = (id: NodeId) => getEntity(graph, id, "node").loc;
	const result: NodeId[] = [];
	corners.forEach((a, i) => {
		const b = corners[(i + 1) % corners.length] as NodeId;
		result.push(a);
		const from = locOf(a);
		const to = locOf(b);
		const between: { id: NodeId; t: number }[] = [];
		for (const [id, loc] of nodes) {
			if (id === a || id === b) continue;
			if (distanceToSegment(loc, from, to) >= SAME_SPOT) continue;
			const t = along(loc, from, to);
			if (t > 0 && t < 1) between.push({ id, t });
		}
		between.sort((x, y) => x.t - y.t);
		for (const { id } of between) {
			if (!result.includes(id)) result.push(id);
		}
	});
	return result;
}

/** A way's nodes with the new nodes that lie on its sides put in, in order along each side. */
function withNewNodes(
	graph: Graph,
	way: readonly NodeId[],
	added: readonly { id: NodeId; loc: Loc }[],
): NodeId[] {
	const result: NodeId[] = [];
	way.forEach((id, i) => {
		const previous = way[i - 1];
		if (previous !== undefined) {
			const from = getEntity(graph, previous, "node").loc;
			const to = getEntity(graph, id, "node").loc;
			const on = added
				.filter(
					(n) =>
						!way.includes(n.id) &&
						distanceToSegment(n.loc, from, to) < SAME_SPOT,
				)
				.map((n) => ({ id: n.id, t: along(n.loc, from, to) }))
				.filter((n) => n.t > 0 && n.t < 1)
				.sort((x, y) => x.t - y.t);
			result.push(...on.map((n) => n.id));
		}
		result.push(id);
	});
	return result;
}

/** How far along a–b the point nearest `p` is, 0 at a and 1 at b (in degrees, near enough). */
function along(p: Loc, a: Loc, b: Loc): number {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const length2 = dx * dx + dy * dy;
	return length2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2 : 0;
}
