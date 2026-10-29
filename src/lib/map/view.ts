/**
 * The part of the world the map shows, and conversions between map positions and screen
 * points, for code that holds the map but shouldn't repeat MapLibre's calls (R5).
 */
import type { Loc } from "#lib/osm/entity.ts";
import type { Extent } from "#lib/osm/geometry.ts";
import type { Map as MapLibreMap } from "./maplibre.ts";

/** The map in view, as an extent; undefined before the map exists. */
export function visibleExtent(
	map: MapLibreMap | undefined,
): Extent | undefined {
	const bounds = map?.getBounds();
	return (
		bounds && {
			west: bounds.getWest(),
			south: bounds.getSouth(),
			east: bounds.getEast(),
			north: bounds.getNorth(),
		}
	);
}

/** Where a position is on screen; NaN before the map exists. */
export function projectLoc(
	map: MapLibreMap | undefined,
	loc: Loc,
): { x: number; y: number } {
	return map?.project([loc[0], loc[1]]) ?? { x: Number.NaN, y: Number.NaN };
}

/** The position under a screen point; [0, 0] before the map exists. */
export function unprojectPoint(
	map: MapLibreMap | undefined,
	point: { x: number; y: number },
): Loc {
	const { lng, lat } = map?.unproject([point.x, point.y]) ?? { lng: 0, lat: 0 };
	return [lng, lat];
}
