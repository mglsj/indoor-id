/**
 * The band iD's partial fill draws inside an area (`css/70_fills.css`): a wide stroke clipped
 * to the area, covering what lies inside it within half the stroke's width of its outline.
 * MapLibre can't clip a line to a polygon, and an inset line overlaps itself in corners and
 * pokes out of sharp ones; the band is built here as a shape instead, the area minus the area
 * shrunk by the band's width (Clipper2's offset, round at the corners), drawn as one fill.
 * Worked in Web Mercator, where screen pixels are square, in millimetres from the first corner.
 * Pure.
 */
import {
	area,
	difference,
	EndType,
	FillRule,
	inflatePaths,
	isPositive,
	JoinType,
	type Path64,
	type Paths64,
	PointInPolygonResult,
	pointInPolygon,
	union,
} from "clipper2-ts";
import {
	EARTH_RADIUS,
	type Extent,
	extentOf,
	extentsIntersect,
	fromMercator,
	toMercator,
} from "#lib/osm/geometry.ts";

export type AreaGeometry =
	| { type: "Polygon"; coordinates: number[][][] }
	| { type: "MultiPolygon"; coordinates: number[][][][] };

export interface BandGeometry {
	type: "MultiPolygon";
	coordinates: number[][][][];
}

/** Clipper works on integers: millimetres. */
const SCALE = 1000;

/**
 * The band inside `area` within `width` Web Mercator metres of its outline (holes' outlines
 * too), in longitude and latitude; null when the area is empty. A small area is filled whole.
 */
export function areaBand(
	area: AreaGeometry,
	width: number,
): BandGeometry | null {
	const polygons =
		area.type === "Polygon" ? [area.coordinates] : area.coordinates;
	const first = polygons[0]?.[0]?.[0];
	if (!first) return null;
	const [ox, oy] = toMercator(first);
	const toPath = (ring: number[][]): Path64 =>
		ring.slice(0, -1).map((p) => {
			const [x, y] = toMercator(p);
			return {
				x: Math.round((x - ox) * SCALE),
				y: Math.round((y - oy) * SCALE),
			};
		});
	const rings: Paths64 = polygons.flatMap((polygon) => polygon.map(toPath));
	// Outer rings one way, holes the other, overlaps resolved, as the offset expects.
	const shape = union(rings, FillRule.EvenOdd);
	const inner = inflatePaths(
		shape,
		-width * SCALE,
		JoinType.Round,
		EndType.Polygon,
	);
	const band = difference(shape, inner, FillRule.NonZero);
	if (band.length === 0) return null;
	const toRing = (path: Path64): number[][] => {
		const ring = path.map((p) =>
			fromMercator([p.x / SCALE + ox, p.y / SCALE + oy]),
		);
		const start = ring[0];
		if (start) ring.push(start);
		return ring;
	};
	return {
		type: "MultiPolygon",
		coordinates: groupRings(band).map((polygon) => polygon.map(toRing)),
	};
}

/**
 * Clipper's rings as polygons: each outer ring (positive area) with the holes inside it, the
 * smallest outer ring holding a hole taking it.
 */
function groupRings(paths: Paths64): Path64[][] {
	const outers = paths.filter((p) => isPositive(p));
	const polygons = outers.map((outer) => [outer]);
	const areas = outers.map((outer) => Math.abs(area(outer)));
	for (const hole of paths.filter((p) => !isPositive(p))) {
		const at = hole[0];
		if (!at) continue;
		let best = -1;
		outers.forEach((outer, i) => {
			if (
				pointInPolygon(at, outer) !== PointInPolygonResult.IsOutside &&
				(best < 0 || (areas[i] ?? 0) < (areas[best] ?? 0))
			)
				best = i;
		});
		if (best >= 0) polygons[best]?.push(hole);
	}
	return polygons;
}

/** Half the width iD's partial fill strokes (`css/70_fills.css`), in pixels at zoom 19+. */
export function bandPixels(kind: unknown): number {
	return kind === "building" ? 30 : 10;
}

/** Bands are built for zooms in half steps: within one, they scale with the map. */
export function bandZoom(zoom: number): number {
	return Math.round(zoom * 2) / 2;
}

/**
 * The band's width in Web Mercator metres at a (band) zoom: its pixels, halved at zoom 17
 * and less (narrow rooms), in 512 px tiles.
 */
export function bandWidth(kind: unknown, zoom: number): number {
	const scale = Math.min(1, Math.max(0.5, 0.5 + (zoom - 17) / 4));
	return (
		(bandPixels(kind) * scale * 2 * Math.PI * EARTH_RADIUS) / (512 * 2 ** zoom)
	);
}

interface Area {
	readonly id: string;
	readonly geometry: AreaGeometry;
	readonly properties: Record<string, unknown>;
}

interface Built {
	readonly area: Area;
	readonly zoom: number;
	readonly band: BandGeometry | null;
}

/**
 * The bands of the areas in view, built once per area and band zoom: a moved map builds only
 * the areas come into view, an edit only the areas it changed.
 */
export class BandStore {
	#built = new Map<string, Built>();

	/**
	 * The bands of `areas` whose extent meets `view` at `zoom` (a band zoom), as features
	 * carrying the area's properties; whether they differ from the last ones.
	 */
	update(
		areas: Iterable<Area>,
		view: Extent,
		zoom: number,
	): { features: GeoJSON.Feature[]; changed: boolean } {
		let changed = false;
		const next = new Map<string, Built>();
		for (const area of areas) {
			const extent = areaExtent(area.geometry);
			if (!extent || !extentsIntersect(extent, view)) continue;
			const before = this.#built.get(area.id);
			// Features left alone by an edit keep their geometry and properties objects.
			if (
				before &&
				before.zoom === zoom &&
				before.area.geometry === area.geometry &&
				before.area.properties === area.properties
			) {
				next.set(area.id, before);
				continue;
			}
			changed = true;
			next.set(area.id, {
				area,
				zoom,
				band: areaBand(
					area.geometry,
					bandWidth(area.properties["@kind"], zoom),
				),
			});
		}
		if (next.size !== this.#built.size) changed = true;
		this.#built = next;
		const features: GeoJSON.Feature[] = [];
		for (const { area, band } of next.values()) {
			if (band)
				features.push({
					type: "Feature",
					geometry: band,
					properties: area.properties,
				});
		}
		return { features, changed };
	}
}

function areaExtent(geometry: AreaGeometry): Extent | null {
	const rings =
		geometry.type === "Polygon"
			? geometry.coordinates
			: geometry.coordinates.flat();
	return extentOf(rings.flat());
}
