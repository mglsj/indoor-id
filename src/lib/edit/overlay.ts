/**
 * The edit overlay's features (P5.3.1), drawn above the indoor layers: the vertices of the
 * selected and hovered ways, which a press drags; the midpoints of the selected ways' sides,
 * which a drag turns into a new vertex; the vertices shared by several ways in view from zoom
 * 18 (iD's junctions); and the untagged member ways of a selected or hovered relation, which
 * the indoor layers don't draw, as thin lines.
 */
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { EntityId, Loc, NodeId, Way, WayId } from "#lib/osm/entity.ts";
import {
	EARTH_RADIUS,
	midpoint,
	toMercator,
	wayLocs,
} from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import { hasInterestingTags } from "#lib/osm/tags.ts";

/** A vertex, by its node's id. */
export interface VertexProperties {
	readonly "@role": "vertex";
	readonly "@id": NodeId;
	/** Used by several ways: moving it moves them all. */
	readonly "@shared"?: "yes";
}

/** The middle of a side from `@a` to `@b` (of `@way` and any way sharing it). */
export interface MidpointProperties {
	readonly "@role": "midpoint";
	readonly "@id": string;
	readonly "@way": WayId;
	readonly "@a": NodeId;
	readonly "@b": NodeId;
}

export interface MemberProperties {
	readonly "@role": "member";
	readonly "@id": WayId;
}

/** A line being drawn: a split's cut (P5.3.5) or a lasso (P5.3.6), until it is finished. */
export interface CutProperties {
	readonly "@role": "cut";
	readonly "@id": "cut";
}

export type OverlayProperties =
	| VertexProperties
	| MidpointProperties
	| MemberProperties
	| CutProperties;

/** A cut line or a lasso being drawn, as an overlay feature (none under two points). */
export function cutFeature(cut: readonly Loc[]): OverlayFeature[] {
	return cut.length < 2
		? []
		: [
				{
					type: "Feature",
					geometry: { type: "LineString", coordinates: cut.map((p) => [...p]) },
					properties: { "@role": "cut", "@id": "cut" },
				},
			];
}

export type OverlayFeature = Feature<Point | LineString, OverlayProperties>;

export interface OverlayOptions {
	readonly selected: readonly EntityId[];
	readonly hover: EntityId | null;
	/** The map's zoom: midpoints need room, junctions show from zoom 18. */
	readonly zoom: number;
	/** The drawn nodes in view on the shown level, for the junctions (asked from zoom 18). */
	readonly nodesInView?: () => Iterable<{ readonly id: NodeId }>;
}

/** Junctions in view are shown from this zoom. */
export const SHARED_VERTEX_ZOOM = 18;
/** A side gets a midpoint once it is this long on screen. */
const MIDPOINT_PIXELS = 40;
/** MapLibre's tile size: a zoom level's world is 512 · 2^zoom pixels wide. */
const TILE_SIZE = 512;

export function overlayFeatures(
	graph: Graph,
	{ selected, hover, zoom, nodesInView }: OverlayOptions,
): FeatureCollection<Point | LineString, OverlayProperties> {
	const features: OverlayFeature[] = [];
	const vertices = new Set<NodeId>();
	const addVertices = (way: Way) => {
		for (const node of way.nodes) vertices.add(node);
	};

	const selectedWays = new Map<WayId, Way>();
	const members = new Map<WayId, Way>();
	const show = (id: EntityId, isSelected: boolean) => {
		const entity = graph.entity(id);
		if (!entity) return;
		switch (entity.type) {
			case "way":
				addVertices(entity);
				if (isSelected) selectedWays.set(entity.id, entity);
				break;
			case "node":
				// A selected vertex shows its ways' vertices around it, as iD.
				if (!isSelected) break;
				for (const way of graph.parentWays(entity.id)) addVertices(way);
				break;
			case "relation":
				for (const member of entity.members) {
					const way = graph.entity(member.ref);
					if (way?.type !== "way") continue;
					addVertices(way);
					if (isSelected) selectedWays.set(way.id, way);
					if (!hasInterestingTags(way.tags)) members.set(way.id, way);
				}
				break;
		}
	};
	for (const id of selected) show(id, true);
	if (hover) show(hover, false);

	for (const way of members.values()) {
		const coordinates = wayLocs(graph, way).map(position);
		if (coordinates.length < 2) continue;
		features.push({
			type: "Feature",
			geometry: { type: "LineString", coordinates },
			properties: { "@role": "member", "@id": way.id },
		});
	}

	const pixelsPerMetre = (TILE_SIZE * 2 ** zoom) / (2 * Math.PI * EARTH_RADIUS);
	const sides = new Set<string>();
	for (const way of selectedWays.values()) {
		for (let i = 1; i < way.nodes.length; i++) {
			const a = graph.entity(way.nodes[i - 1] as NodeId);
			const b = graph.entity(way.nodes[i] as NodeId);
			if (a?.type !== "node" || b?.type !== "node") continue;
			const key = a.id < b.id ? `${a.id} ${b.id}` : `${b.id} ${a.id}`;
			if (sides.has(key)) continue;
			sides.add(key);
			const [ax, ay] = toMercator(a.loc);
			const [bx, by] = toMercator(b.loc);
			if (Math.hypot(bx - ax, by - ay) * pixelsPerMetre < MIDPOINT_PIXELS)
				continue;
			features.push({
				type: "Feature",
				geometry: { type: "Point", coordinates: midpoint(a.loc, b.loc) },
				properties: {
					"@role": "midpoint",
					"@id": `${way.id}:${a.id}:${b.id}`,
					"@way": way.id,
					"@a": a.id,
					"@b": b.id,
				},
			});
		}
	}

	const shared = (id: NodeId) => graph.parentWays(id).length > 1;
	if (zoom >= SHARED_VERTEX_ZOOM && nodesInView) {
		for (const { id } of nodesInView()) {
			if (shared(id)) vertices.add(id);
		}
	}
	for (const id of vertices) {
		const node = graph.entity(id);
		if (node?.type !== "node") continue;
		features.push({
			type: "Feature",
			geometry: { type: "Point", coordinates: position(node.loc) },
			properties: shared(id)
				? { "@role": "vertex", "@id": id, "@shared": "yes" }
				: { "@role": "vertex", "@id": id },
		});
	}
	return { type: "FeatureCollection", features };
}

function position(loc: Loc): number[] {
	return [loc[0], loc[1]];
}
