/**
 * Cut out of the level outline (P6, osm-simple3d-editor `6e898c1`): a quick way to draw the
 * holes in a floor (atriums, light wells, stair voids) the forum endorses and 3D.3 reads. A
 * closed way drawn inside the `indoor=level` outline of its level becomes a hole in it: the
 * outline becomes a multipolygon (or gets one more inner ring), as `makeMultipolygon` does
 * with both selected. Pure.
 */
import { featureLevels } from "#lib/levels/feature-levels.ts";
import { isOnLevel } from "#lib/levels/levels.ts";
import type { Entity, EntityId, Loc, WayId } from "#lib/osm/entity.ts";
import {
	extentOf,
	isClosedRing,
	pointInRing,
	wayLocs,
} from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";
import { makeMultipolygon } from "./multipolygon.ts";

/**
 * The `indoor=level` outline (a way, or a multipolygon) on `level` whose outer ring holds the
 * whole of way `id`; the smallest when several do. Null when none does, or `id` isn't a
 * closed way. Scans the loaded ways and relations: for an operation, not each pointer move.
 */
export function levelOutlineAround(
	graph: Graph,
	id: WayId,
	level: number,
): EntityId | null {
	const way = graph.entity(id);
	if (way?.type !== "way" || !isClosedRing(way)) return null;
	if (way.tags.indoor === "level") return null;
	const inner = wayLocs(graph, way);
	const box = extentOf(inner);
	if (!box) return null;
	let best: { id: EntityId; area: number } | null = null;
	for (const entity of graph.entities()) {
		if (entity.type === "node" || entity.tags.indoor !== "level") continue;
		if (entity.id === id) continue;
		const levels = featureLevels(entity.tags);
		if (!levels || !isOnLevel(levels, level)) continue;
		for (const ring of outerRings(graph, entity)) {
			const around = extentOf(ring);
			if (
				!around ||
				box.west < around.west ||
				box.east > around.east ||
				box.south < around.south ||
				box.north > around.north
			)
				continue;
			if (!inner.every((loc) => pointInRing(loc, ring))) continue;
			const area = Math.abs(shoelace(ring));
			if (!best || area < best.area) best = { id: entity.id, area };
		}
	}
	return best?.id ?? null;
}

/** Cuts way `id` out of the level outline around it on `level`; unchanged when there is none. */
export function cutOutOfLevel(id: WayId, level: number): Action {
	return (graph) => {
		const outline = levelOutlineAround(graph, id, level);
		if (!outline) return graph;
		return makeMultipolygon(graph, [outline, id])?.graph ?? graph;
	};
}

function outerRings(graph: Graph, entity: Entity): Loc[][] {
	if (entity.type === "way")
		return isClosedRing(entity) ? [wayLocs(graph, entity)] : [];
	if (entity.type !== "relation" || entity.tags.type !== "multipolygon")
		return [];
	return entity.members.flatMap((m) => {
		if (m.role !== "outer" && m.role !== "") return [];
		const member = graph.entity(m.ref);
		return member?.type === "way" && isClosedRing(member)
			? [wayLocs(graph, member)]
			: [];
	});
}

function shoelace(ring: readonly Loc[]): number {
	let sum = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i] as Loc;
		const [xj, yj] = ring[j] as Loc;
		sum += (xj + xi) * (yj - yi);
	}
	return sum / 2;
}
