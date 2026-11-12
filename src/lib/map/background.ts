/**
 * The raster imagery shown under the indoor data, on top of the vector basemap, moved by its
 * offset, or a solid colour in place of the basemap. MapLibre's raster layers can't be
 * translated, so imagery tiles go through the `offset-tile` protocol: each tile is drawn from
 * the (up to four) source tiles it overlaps, and the URL names the offset. Moving the offset
 * only changes the source's URL (`setTiles`): MapLibre keeps drawing the tiles it has while it
 * asks for the moved ones, and these are drawn from source tiles kept in memory, so a drag
 * follows the pointer as iD's does.
 */

import {
	displayPaint,
	type Imagery,
	type ImageryDisplay,
	type Offset,
	offsetPixels,
	offsetTileParts,
	PLAIN_DISPLAY,
	tileUrl,
} from "./backgrounds.ts";
import { setBasemapShown } from "./basemap.ts";
import { slotId, slotsReady } from "./layer-slots.ts";
import {
	addProtocol,
	type Map as MapLibreMap,
	type RasterSourceSpecification,
} from "./maplibre.ts";

/** Imagery layers and sources are named with this prefix and a number. */
const PREFIX = "background-imagery";
const PROTOCOL = "offset-tile";
const TILE_SIZE = 256;

/** The source of each imagery shown, by key: the protocol's URLs name it. */
const sources = new Map<string, RasterSourceSpecification>();
let lastKey = 0;
let lastLayer = 0;
let registered = false;

const displays = new WeakMap<MapLibreMap, ImageryDisplay>();
/** The imagery each layer shows (its key and source), to move it without a new layer. */
const shown = new Map<
	string,
	{ key: string; source: RasterSourceSpecification }
>();

/** The layer of the solid colour shown in place of the basemap. */
const SOLID_LAYER = "background-solid";

/** The imagery layers on the map, oldest first (each with its source of the same id). */
function imageryLayers(map: MapLibreMap): string[] {
	return (map.getStyle()?.layers ?? [])
		.map((layer) => layer.id)
		.filter((id) => id.startsWith(`${PREFIX}-`));
}

function removeImagery(map: MapLibreMap, id: string) {
	if (map.getLayer(id)) map.removeLayer(id);
	const entry = shown.get(id);
	if (entry) sources.delete(entry.key);
	shown.delete(id);
	if (map.getSource(id)) map.removeSource(id);
}

/**
 * Shows imagery moved by `offset`, or only the basemap when `imagery` is null. A new offset for
 * the imagery shown moves its tiles in place; other imagery stays under the new one until its
 * tiles are in, so changing it doesn't flash the basemap.
 */
export async function setBackground(
	map: MapLibreMap,
	imagery: Imagery | null,
	offset: Offset,
): Promise<void> {
	await slotsReady(map);
	const before = imageryLayers(map);
	if (!imagery) {
		for (const id of before) removeImagery(map, id);
		return;
	}
	const last = before.at(-1);
	const current = last ? shown.get(last) : undefined;
	if (last && current?.source === imagery.source) {
		const source = map.getSource(last) as
			| { setTiles(tiles: string[]): void; tiles?: string[] }
			| undefined;
		const tiles = tileUrls(current.key, offset);
		if (source && source.tiles?.[0] !== tiles[0]) source.setTiles(tiles);
		return;
	}
	const id = `${PREFIX}-${++lastLayer}`;
	registerProtocol();
	const key = String(++lastKey);
	sources.set(key, imagery.source);
	shown.set(id, { key, source: imagery.source });
	const { scheme: _, tiles: __, ...rest } = imagery.source;
	map.addSource(id, { ...rest, tiles: tileUrls(key, offset) });
	map.addLayer(
		{
			id,
			type: "raster",
			source: id,
			paint: {
				...displayPaint(displays.get(map) ?? PLAIN_DISPLAY),
				// Moved tiles replace the others at once, as iD's do.
				"raster-fade-duration": 0,
			},
		},
		slotId("imagery"),
	);
	if (before.length === 0) return;
	await loaded(map, id);
	for (const old of before) removeImagery(map, old);
}

/** The tile URLs of imagery `key` moved by `offset`, in metres east and north. */
function tileUrls(key: string, { east, north }: Offset): string[] {
	return [`${PROTOCOL}://${key}/${east}/${north}/{z}/{x}/{y}`];
}

/**
 * Shows a solid colour in place of the basemap (its fills and labels hidden), or the basemap
 * again when `color` is null.
 */
export async function setSolidBackground(
	map: MapLibreMap,
	color: string | null,
): Promise<void> {
	await slotsReady(map);
	setBasemapShown(map, color === null);
	if (color === null) {
		if (map.getLayer(SOLID_LAYER)) map.removeLayer(SOLID_LAYER);
		return;
	}
	if (map.getLayer(SOLID_LAYER)) {
		map.setPaintProperty(SOLID_LAYER, "background-color", color);
		return;
	}
	map.addLayer(
		{
			id: SOLID_LAYER,
			type: "background",
			paint: { "background-color": color },
		},
		slotId("imagery"),
	);
}

/** Changes how the imagery shown is displayed (brightness, contrast, saturation). */
export function setImageryDisplay(
	map: MapLibreMap,
	display: ImageryDisplay,
): void {
	displays.set(map, display);
	const paint = displayPaint(display);
	for (const id of imageryLayers(map)) {
		for (const [name, value] of Object.entries(paint)) {
			map.setPaintProperty(id, name as keyof typeof paint, value);
		}
	}
}

/** Resolves once the source's tiles in view are loaded, or after a second at most. */
function loaded(map: MapLibreMap, id: string): Promise<void> {
	return new Promise((resolve) => {
		const done = () => {
			map.off("sourcedata", check);
			clearTimeout(timer);
			resolve();
		};
		const check = () => {
			if (!map.getSource(id) || map.isSourceLoaded(id)) done();
		};
		const timer = setTimeout(done, 1000);
		map.on("sourcedata", check);
	});
}

function registerProtocol() {
	if (registered) return;
	registered = true;
	addProtocol(PROTOCOL, async ({ url }) => {
		const [key = "", east, north, z, x, y] = url
			.slice(PROTOCOL.length + 3)
			.split("/");
		const source = sources.get(key);
		if (!source) throw new Error("This imagery is no longer shown");
		const offset = { east: Number(east), north: Number(north) };
		return {
			data: await movedTile(source, offset, Number(z), Number(x), Number(y)),
		};
	});
}

/**
 * Source tiles, decoded, by URL: a drag draws the same ones again at each step. The oldest
 * are forgotten past `CACHE_SIZE` (about 256 MB of 256 px tiles at most).
 */
const CACHE_SIZE = 1024;
const cache = new Map<string, Promise<ImageBitmap | null>>();

function sourceTile(url: string): Promise<ImageBitmap | null> {
	const hit = cache.get(url);
	if (hit) {
		// Most recently used last.
		cache.delete(url);
		cache.set(url, hit);
		return hit;
	}
	const image = fetch(url)
		.then(async (response) => {
			// A missing tile (404) is remembered as missing; other failures are asked again.
			if (response.status === 404) return null;
			if (!response.ok) throw new Error(`Tile ${url}: ${response.status}`);
			return await createImageBitmap(await response.blob());
		})
		.catch(() => {
			cache.delete(url);
			return null;
		});
	cache.set(url, image);
	if (cache.size > CACHE_SIZE) {
		const oldest = cache.keys().next().value;
		// Not closed: a tile being drawn may still hold it; it is collected once unused.
		if (oldest !== undefined) cache.delete(oldest);
	}
	return image;
}

/** Tile `z/x/y` of imagery moved by `offset`, drawn from the source tiles it overlaps. */
async function movedTile(
	source: RasterSourceSpecification,
	offset: Offset,
	z: number,
	x: number,
	y: number,
): Promise<ImageBitmap> {
	const shift = offsetPixels(offset, z, y, TILE_SIZE);
	const parts = offsetTileParts(z, x, y, shift, TILE_SIZE);
	const images = await Promise.all(
		parts.map((part) => sourceTile(tileUrl(source, z, part.x, part.y))),
	);
	// No source tile at all (past the imagery's last zoom here): answer as a missing tile
	// (404), so that MapLibre scales up the tile above instead.
	if (images.every((image) => image === null)) {
		throw Object.assign(new Error(`No imagery for tile ${z}/${x}/${y}`), {
			status: 404,
		});
	}
	const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
	const context = canvas.getContext("2d");
	if (!context) throw new Error("No 2D canvas to draw imagery tiles");
	images.forEach((image, i) => {
		const part = parts[i];
		if (!image || !part) return;
		context.drawImage(image, part.left, part.top, TILE_SIZE, TILE_SIZE);
	});
	return canvas.transferToImageBitmap();
}
