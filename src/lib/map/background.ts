/**
 * The raster imagery shown under the indoor data, on top of the vector basemap, moved by its
 * offset. MapLibre's raster layers can't be translated, so a moved imagery's tiles go through
 * the `offset-tile` protocol: each tile is drawn from the (up to four) source tiles it overlaps.
 */
import {
	type Imagery,
	type Offset,
	offsetPixels,
	offsetTileParts,
	tileUrl,
} from "./backgrounds.ts";
import { slotId, slotsReady } from "./layer-slots.ts";
import {
	addProtocol,
	type Map as MapLibreMap,
	type RasterSourceSpecification,
} from "./maplibre.ts";

const SOURCE = "background-imagery";
const LAYER = "background-imagery";
const PROTOCOL = "offset-tile";
const TILE_SIZE = 256;

/** The moved imagery of each source made, by key: the protocol's URLs name it. */
const moved = new Map<
	string,
	{ source: RasterSourceSpecification; offset: Offset }
>();
let lastKey = 0;
let registered = false;

/** Shows imagery moved by `offset`, or only the basemap when `imagery` is null. */
export async function setBackground(
	map: MapLibreMap,
	imagery: Imagery | null,
	offset: Offset,
): Promise<void> {
	await slotsReady(map);
	if (map.getLayer(LAYER)) map.removeLayer(LAYER);
	if (map.getSource(SOURCE)) map.removeSource(SOURCE);
	moved.clear();
	if (!imagery) return;
	map.addSource(SOURCE, sourceFor(imagery.source, offset));
	map.addLayer(
		{ id: LAYER, type: "raster", source: SOURCE },
		slotId("imagery"),
	);
}

function sourceFor(
	source: RasterSourceSpecification,
	offset: Offset,
): RasterSourceSpecification {
	if (offset.east === 0 && offset.north === 0) return source;
	registerProtocol();
	const key = String(++lastKey);
	moved.set(key, { source, offset });
	const { scheme: _, ...rest } = source;
	return { ...rest, tiles: [`${PROTOCOL}://${key}/{z}/{x}/{y}`] };
}

function registerProtocol() {
	if (registered) return;
	registered = true;
	addProtocol(PROTOCOL, async ({ url }, abort) => {
		const [key = "", z, x, y] = url.slice(PROTOCOL.length + 3).split("/");
		const entry = moved.get(key);
		if (!entry) throw new Error("This imagery is no longer shown");
		return {
			data: await movedTile(entry, Number(z), Number(x), Number(y), abort),
		};
	});
}

/** Tile `z/x/y` of moved imagery, drawn from the source tiles it overlaps. */
async function movedTile(
	{ source, offset }: { source: RasterSourceSpecification; offset: Offset },
	z: number,
	x: number,
	y: number,
	abort: AbortController,
): Promise<ImageBitmap> {
	const shift = offsetPixels(offset, z, y, TILE_SIZE);
	const parts = offsetTileParts(z, x, y, shift, TILE_SIZE);
	const images = await Promise.all(
		parts.map(async (part) => {
			try {
				const response = await fetch(tileUrl(source, z, part.x, part.y), {
					signal: abort.signal,
				});
				if (!response.ok) return null;
				return await createImageBitmap(await response.blob());
			} catch {
				return null;
			}
		}),
	);
	// No source tile at all (past the imagery's last zoom here): fail, so that MapLibre
	// scales up the tile above instead.
	if (images.every((image) => image === null)) {
		throw new Error(`No imagery for tile ${z}/${x}/${y}`);
	}
	const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
	const context = canvas.getContext("2d");
	if (!context) throw new Error("No 2D canvas to draw imagery tiles");
	images.forEach((image, i) => {
		const part = parts[i];
		if (!image || !part) return;
		context.drawImage(image, part.left, part.top, TILE_SIZE, TILE_SIZE);
		image.close();
	});
	return canvas.transferToImageBitmap();
}
