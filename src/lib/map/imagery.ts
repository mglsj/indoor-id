/**
 * Background imagery from the Editor Layer Index (ELI), the list iD and JOSM use:
 * https://github.com/osmlab/editor-layer-index
 *
 * The index is downloaded once; picking the sources for a place is a cheap lookup (bounding
 * box, then polygon test), done when the map stops moving rather than on a timer.
 */
import type { MultiPolygon, Polygon, Position } from "geojson";
import { extentOf, pointInPolygon } from "#lib/osm/geometry.ts";
import type { RasterSourceSpecification } from "./maplibre.ts";

export const DEFAULT_IMAGERY_INDEX_URL =
	"https://osmlab.github.io/editor-layer-index/imagery.geojson";

/** A feature of the ELI GeoJSON, with the properties we use. */
export interface EliFeature {
	type: "Feature";
	geometry: Polygon | MultiPolygon | null;
	properties: {
		id: string;
		name: string;
		type: string;
		url: string;
		min_zoom?: number;
		max_zoom?: number;
		best?: boolean;
		overlay?: boolean;
		category?: string;
		end_date?: string;
		available_projections?: string[];
		attribution?: { text?: string; url?: string };
	};
}

export interface ImageryEntry {
	readonly id: string;
	readonly name: string;
	readonly best: boolean;
	readonly category?: string;
	readonly source: RasterSourceSpecification;
	/** Coverage, or null for worldwide imagery. */
	readonly polygons: readonly Position[][][] | null;
	readonly bbox: readonly [number, number, number, number] | null;
}

/** Imagery older than this is left out of the list (as in 1.x). */
const MAX_AGE_YEARS = 10;

/** Keeps the background imagery MapLibre can display. */
export function parseImageryIndex(
	index: { type?: "FeatureCollection"; features: EliFeature[] },
	now = new Date(),
): ImageryEntry[] {
	const oldest = new Date(now);
	oldest.setFullYear(oldest.getFullYear() - MAX_AGE_YEARS);

	const entries: ImageryEntry[] = [];
	for (const { geometry, properties: p } of index.features) {
		if (p.overlay) continue;
		if (p.end_date && new Date(p.end_date) < oldest) continue;
		const source = rasterSource(p);
		if (!source) continue;
		const polygons = geometry
			? geometry.type === "Polygon"
				? [geometry.coordinates]
				: geometry.coordinates
			: null;
		entries.push({
			id: p.id,
			name: p.name,
			best: p.best === true,
			category: p.category,
			source,
			polygons,
			bbox: polygons && boundingBox(polygons),
		});
	}
	return entries;
}

/** Imagery covering a place ([lon, lat]), the best sources first. */
export function availableImagery(
	entries: readonly ImageryEntry[],
	point: Position,
): ImageryEntry[] {
	const [x = 0, y = 0] = point;
	return entries
		.filter(({ polygons, bbox }) => {
			if (!polygons || !bbox) return true;
			const [w, s, e, n] = bbox;
			return (
				x >= w &&
				x <= e &&
				y >= s &&
				y <= n &&
				polygons.some((polygon) => pointInPolygon(point, polygon))
			);
		})
		.sort((a, b) => Number(b.best) - Number(a.best));
}

/**
 * Converts an ELI entry into a MapLibre raster source, or null when MapLibre can't display it:
 * Bing (needs a session key), WMS without Web Mercator, sources needing an API key.
 */
export function rasterSource(
	p: EliFeature["properties"],
): RasterSourceSpecification | null {
	let template = p.url;
	let scheme: "tms" | undefined;

	if (p.type === "wms") {
		if (!p.available_projections?.includes("EPSG:3857")) return null;
		template = template
			.replaceAll("{proj}", "EPSG:3857")
			.replaceAll("{bbox}", "{bbox-epsg-3857}")
			.replaceAll("{width}", "256")
			.replaceAll("{height}", "256");
	} else if (p.type === "tms") {
		template = template.replaceAll("{zoom}", "{z}");
		if (template.includes("{-y}")) {
			template = template.replaceAll("{-y}", "{y}");
			scheme = "tms";
		}
	} else {
		return null;
	}

	const tiles = expandSwitch(withoutBlankTiles(template));
	const placeholders = tiles.flatMap((t) => t.match(/\{[^}]*\}/g) ?? []);
	const supported = new Set([
		"{z}",
		"{x}",
		"{y}",
		"{bbox-epsg-3857}",
		"{quadkey}",
	]);
	if (placeholders.some((ph) => !supported.has(ph))) return null;

	const source: RasterSourceSpecification = {
		type: "raster",
		tiles,
		tileSize: 256,
	};
	if (scheme) source.scheme = scheme;
	if (p.min_zoom !== undefined) source.minzoom = p.min_zoom;
	if (p.max_zoom !== undefined) source.maxzoom = p.max_zoom;
	const attribution = attributionHtml(p.attribution);
	if (attribution) source.attribution = attribution;
	return source;
}

/**
 * Esri answers a tile it has no imagery for with a "Map data not yet available" picture, which
 * MapLibre would draw. Asked with `blankTile=false`, it answers 404 instead, and MapLibre draws
 * the nearest lower zoom tile it has, scaled up, as iD does (iD issue #4327).
 */
function withoutBlankTiles(template: string): string {
	const esri =
		/^https:\/\/[^/]*\barcgis(online)?\.com\/.*\/MapServer\/tile\//i.test(
			template,
		);
	if (!esri || /[?&]blankTile=/i.test(template)) return template;
	return `${template}${template.includes("?") ? "&" : "?"}blankTile=false`;
}

/** `https://{switch:a,b}.example.org` → one URL per server. */
function expandSwitch(template: string): string[] {
	const match = /\{switch:([^}]*)\}/.exec(template);
	if (!match) return [template];
	return (match[1] ?? "")
		.split(",")
		.map((server) => template.replace(match[0], server.trim()));
}

/** MapLibre shows attributions as HTML: escape the text, and only link to web pages. */
function attributionHtml(
	attribution: EliFeature["properties"]["attribution"],
): string | null {
	if (!attribution?.text) return null;
	const text = escapeHtml(attribution.text);
	const url = attribution.url;
	return url && /^https?:\/\//.test(url)
		? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${text}</a>`
		: text;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function boundingBox(
	polygons: readonly Position[][][],
): [number, number, number, number] {
	const extent = extentOf(polygons.flatMap((polygon) => polygon[0] ?? []));
	if (!extent) return [Infinity, Infinity, -Infinity, -Infinity];
	return [extent.west, extent.south, extent.east, extent.north];
}

/** Downloads and parses the imagery index. */
export async function loadImageryIndex(
	url = DEFAULT_IMAGERY_INDEX_URL,
	fetchFn: typeof fetch = fetch,
): Promise<ImageryEntry[]> {
	const response = await fetchFn(url);
	if (!response.ok) {
		throw new Error(
			`Could not load the imagery list (HTTP ${response.status})`,
		);
	}
	return parseImageryIndex(await response.json());
}
