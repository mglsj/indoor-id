/**
 * The backgrounds the map offers: the OpenFreeMap vector map (its light style: the map stays
 * light in the dark theme, where a dark map is hard to read), Esri's imagery, a tile URL the
 * user enters, or a solid colour. The list is fixed: no index is
 * downloaded. Imagery can be moved by an offset in metres, as in iD, when it doesn't line up
 * with the data; `tilesIn` and `inAncestor` say which tiles are drawn where.
 */
import { EARTH_RADIUS } from "#lib/osm/geometry.ts";
import type { RasterSourceSpecification } from "./maplibre.ts";

/** The OpenFreeMap style under the imagery. */
export const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

/** The vector map ("OpenFreeMap Light"), imagery, or a solid colour in place of the map. */
export type BackgroundId = "map" | "esri" | "esri-clarity" | "custom" | "solid";

/** The solid colour shown at first: the light map's land colour. */
export const DEFAULT_SOLID_COLOR = "#f2f2ef";

/** Imagery shown over the vector map. */
export interface Imagery {
	readonly id: Exclude<BackgroundId, "map" | "solid">;
	/** Its name, as the changeset's `imagery_used` records it. */
	readonly name: string;
	readonly source: RasterSourceSpecification;
}

const ESRI_ATTRIBUTION = {
	text: "Terms & Feedback",
	url: "https://wiki.openstreetmap.org/wiki/Esri",
};

/** Esri's imagery, from the Editor Layer Index entries iD offers. */
export const ESRI_IMAGERY: readonly Imagery[] = [
	{
		id: "esri",
		name: "Esri World Imagery",
		source: rasterSource(
			"https://{switch:services,server}.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{zoom}/{y}/{x}",
			{ maxzoom: 22, attribution: ESRI_ATTRIBUTION },
		) as RasterSourceSpecification,
	},
	{
		id: "esri-clarity",
		name: "Esri World Imagery (Clarity) Beta",
		source: rasterSource(
			"https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{zoom}/{y}/{x}",
			{ maxzoom: 22, attribution: ESRI_ATTRIBUTION },
		) as RasterSourceSpecification,
	},
];

/** Imagery from a tile URL the user typed, or null when MapLibre can't show it. */
export function customImagery(template: string): Imagery | null {
	const trimmed = template.trim();
	if (!/^https?:\/\//i.test(trimmed)) return null;
	const source = rasterSource(trimmed, { maxzoom: 22 });
	if (!source) return null;
	// Named after its URL, so that the changeset says which imagery was used.
	return { id: "custom", name: `Custom (${trimmed})`, source };
}

/** The imagery shown for a background, null for the map alone or a solid colour. */
export function imageryFor(
	id: BackgroundId,
	customTemplate: string,
): Imagery | null {
	if (id === "map" || id === "solid") return null;
	if (id === "custom") return customImagery(customTemplate);
	return ESRI_IMAGERY.find((imagery) => imagery.id === id) ?? null;
}

interface SourceOptions {
	minzoom?: number;
	maxzoom?: number;
	attribution?: { text: string; url?: string };
}

/**
 * Converts a tile URL template, in the Editor Layer Index's syntax (`{zoom}`, `{-y}`,
 * `{switch:a,b}`) or MapLibre's (`{z}`, `{quadkey}`, `{bbox-epsg-3857}`), into a MapLibre
 * raster source, or null when it has a placeholder MapLibre doesn't fill (an API key).
 */
export function rasterSource(
	url: string,
	options: SourceOptions = {},
): RasterSourceSpecification | null {
	let template = url.replaceAll("{zoom}", "{z}");
	let scheme: "tms" | undefined;
	if (template.includes("{-y}")) {
		template = template.replaceAll("{-y}", "{y}");
		scheme = "tms";
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
	const locates = (t: string) =>
		["{z}", "{x}", "{y}"].every((ph) => t.includes(ph)) ||
		t.includes("{quadkey}") ||
		t.includes("{bbox-epsg-3857}");
	if (!tiles.every(locates)) return null;

	const source: RasterSourceSpecification = {
		type: "raster",
		tiles,
		tileSize: 256,
	};
	if (scheme) source.scheme = scheme;
	if (options.minzoom !== undefined) source.minzoom = options.minzoom;
	if (options.maxzoom !== undefined) source.maxzoom = options.maxzoom;
	const attribution = attributionHtml(options.attribution);
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
function attributionHtml(attribution: SourceOptions["attribution"]) {
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

/** How far imagery is moved, in metres on the ground: east and north. */
export interface Offset {
	readonly east: number;
	readonly north: number;
}

export const NO_OFFSET: Offset = { east: 0, north: 0 };

/**
 * An offset in world pixels (the Web Mercator world is `worldSize` pixels wide): right and
 * down. Web Mercator stretches the ground by 1 / cos(latitude), taken at `lat` (the view's
 * centre, so the imagery moves as one piece).
 */
export function offsetPixels(
	offset: Offset,
	lat: number,
	worldSize: number,
): [number, number] {
	const pixelsPerMetre = worldSize / (2 * Math.PI * EARTH_RADIUS);
	const scale = pixelsPerMetre / Math.cos((lat * Math.PI) / 180);
	return [offset.east * scale, -offset.north * scale];
}

/** A tile to draw: `x` may lie outside the world (a copy east or west), `column` is its tile. */
export interface ViewTile {
	readonly z: number;
	readonly x: number;
	readonly y: number;
	/** `x` wrapped into the world: the tile to fetch. */
	readonly column: number;
}

/**
 * The zoom `z` tiles covering a box in degrees (west may be under -180 and east over 180, on
 * the world's copies), with `pad` more tiles on every side for an imagery moved by an offset.
 */
export function tilesIn(
	box: {
		readonly west: number;
		readonly south: number;
		readonly east: number;
		readonly north: number;
	},
	z: number,
	pad = 1,
): ViewTile[] {
	const n = 2 ** z;
	const column = (lon: number) => Math.floor(((lon + 180) / 360) * n);
	const row = (lat: number) => {
		const clamped = Math.max(-85.0511287798, Math.min(85.0511287798, lat));
		const sin = Math.sin((clamped * Math.PI) / 180);
		return Math.floor(
			(0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n,
		);
	};
	const tiles: ViewTile[] = [];
	const top = Math.max(0, row(box.north) - pad);
	const bottom = Math.min(n - 1, row(box.south) + pad);
	for (let y = top; y <= bottom; y++) {
		for (let x = column(box.west) - pad; x <= column(box.east) + pad; x++) {
			tiles.push({ z, x, y, column: ((x % n) + n) % n });
		}
	}
	return tiles;
}

/**
 * Where tile `z/x/y` lies in its ancestor at zoom `az`: the ancestor's column and row, and the
 * part of it the tile covers (left, top and size, from 0 to 1).
 */
export function inAncestor(
	z: number,
	x: number,
	y: number,
	az: number,
): { x: number; y: number; left: number; top: number; size: number } {
	const scale = 2 ** (z - az);
	const ax = Math.floor(x / scale);
	const ay = Math.floor(y / scale);
	return {
		x: ax,
		y: ay,
		left: x / scale - ax,
		top: y / scale - ay,
		size: 1 / scale,
	};
}

/** The URL of tile `z/x/y` of a raster source, picking its server as MapLibre does. */
export function tileUrl(
	source: RasterSourceSpecification,
	z: number,
	x: number,
	y: number,
): string {
	const tiles = source.tiles ?? [];
	const template = tiles[(x + y) % tiles.length] ?? "";
	const row = source.scheme === "tms" ? 2 ** z - 1 - y : y;
	return template
		.replaceAll("{z}", String(z))
		.replaceAll("{x}", String(x))
		.replaceAll("{y}", String(row))
		.replaceAll("{quadkey}", quadkey(z, x, y))
		.replaceAll("{bbox-epsg-3857}", bbox(z, x, y).join(","));
}

function quadkey(z: number, x: number, y: number): string {
	let key = "";
	for (let i = z; i > 0; i--) {
		const mask = 1 << (i - 1);
		key += String((x & mask ? 1 : 0) + (y & mask ? 2 : 0));
	}
	return key;
}

function bbox(z: number, x: number, y: number): number[] {
	const world = 2 * Math.PI * EARTH_RADIUS;
	const size = world / 2 ** z;
	const west = -world / 2 + x * size;
	const north = world / 2 - y * size;
	return [west, north - size, west + size, north];
}

/**
 * How imagery is displayed, as iD's imagery display options: 1 is as served. Brightness from
 * 0.25 to 2, contrast and saturation from 0 to 2.
 */
export interface ImageryDisplay {
	readonly brightness: number;
	readonly contrast: number;
	readonly saturation: number;
}

export const PLAIN_DISPLAY: ImageryDisplay = {
	brightness: 1,
	contrast: 1,
	saturation: 1,
};

/** MapLibre's raster paint for a display: brightness narrows or lifts the range of values. */
export function displayPaint({
	brightness,
	contrast,
	saturation,
}: ImageryDisplay): {
	"raster-brightness-min": number;
	"raster-brightness-max": number;
	"raster-contrast": number;
	"raster-saturation": number;
} {
	const clamp = (value: number) => Math.max(-1, Math.min(1, value));
	return {
		"raster-brightness-min": Math.min(1, Math.max(0, brightness - 1)),
		"raster-brightness-max": Math.min(1, brightness),
		// MapLibre's contrast and saturation go from -1 to 1, 0 leaving the imagery as it is.
		"raster-contrast": clamp(contrast - 1),
		"raster-saturation": clamp(saturation - 1),
	};
}
