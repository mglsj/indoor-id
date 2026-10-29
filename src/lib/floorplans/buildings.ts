/**
 * The OSM buildings a floor plan can be assigned to (P5.3.10): those whose outline runs under
 * the plan, the one around the plan's centre first, named as the plan list shows them.
 */
import type { EntityId, Way } from "#lib/osm/entity.ts";
import { pointInRing, wayLocs } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { Tags } from "#lib/osm/tags.ts";
import type { LngLat } from "./georef.ts";

export interface PlanBuilding {
	/** Its way or relation id. */
	readonly id: string;
	readonly name: string;
}

const isBuilding = (tags: Tags) =>
	tags.building !== undefined && tags.building !== "no";

/**
 * The buildings drawn by `ways` (the ways with a side under the plan): a way tagged
 * `building=*`, or a building multipolygon it is a member of. Those whose outline holds
 * `centre` come first.
 */
export function buildingsUnder(
	graph: Graph,
	ways: Iterable<EntityId>,
	centre: LngLat,
): PlanBuilding[] {
	const found = new Map<string, { building: PlanBuilding; holds: boolean }>();
	for (const id of new Set(ways)) {
		const way = graph.entity(id);
		if (way?.type !== "way") continue;
		const owners = [
			...(isBuilding(way.tags) ? [way] : []),
			...graph.parentRelations(way.id).filter((r) => isBuilding(r.tags)),
		];
		for (const owner of owners) {
			const holds = pointInRing(centre, wayLocs(graph, way as Way));
			const known = found.get(owner.id);
			if (known) {
				if (holds && !known.holds) known.holds = true;
				continue;
			}
			found.set(owner.id, {
				building: { id: owner.id, name: buildingName(owner.tags, owner.id) },
				holds,
			});
		}
	}
	return [...found.values()]
		.sort((a, b) => Number(b.holds) - Number(a.holds))
		.map((f) => f.building);
}

/** A building's name: its name, else its address, else its id. */
export function buildingName(tags: Tags, id: string): string {
	const address = [tags["addr:housenumber"], tags["addr:street"]]
		.filter(Boolean)
		.join(" ");
	return tags.name ?? (address || `Building ${id}`);
}
