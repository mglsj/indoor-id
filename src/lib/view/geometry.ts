/** Small helpers on the map's GeoJSON features, for the viewer's panel and room colours. */
import type { Geometry, Position } from "geojson";
import { type Extent, extentOf } from "#lib/osm/geometry.ts";

/** The levels in a feature's `@lv` (`;-1;0;`), or null for `*` (on every level). */
export function levelsOf(lv: string): number[] | null {
	if (lv === "*") return null;
	return lv
		.split(";")
		.filter((part) => part !== "")
		.map(Number);
}

/** Every position of a geometry. */
export function* positions(geometry: Geometry): Generator<Position> {
	switch (geometry.type) {
		case "Point":
			yield geometry.coordinates;
			break;
		case "LineString":
		case "MultiPoint":
			yield* geometry.coordinates;
			break;
		case "Polygon":
		case "MultiLineString":
			for (const ring of geometry.coordinates) yield* ring;
			break;
		case "MultiPolygon":
			for (const polygon of geometry.coordinates) {
				for (const ring of polygon) yield* ring;
			}
			break;
		case "GeometryCollection":
			for (const part of geometry.geometries) yield* positions(part);
			break;
	}
}

/** A geometry's extent. */
export function extentOfGeometry(geometry: Geometry): Extent | null {
	return extentOf(positions(geometry) as Iterable<[number, number]>);
}
