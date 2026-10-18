/**
 * Large floor plans are split into tiles: GPUs cap texture sizes (often 4096 px, less on some
 * phones), and smaller textures upload faster. Each tile becomes its own MapLibre image source,
 * placed through the plan's transform so that neighbours meet exactly.
 */
import { type LngLat, project, type Transform } from "./georef.ts";

/** Largest tile side, in pixels: safe on every GPU MapLibre runs on. */
export const MAX_TILE_SIZE = 2048;

export interface Tile {
	/** Top-left pixel of the tile in the plan image. */
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** Tiles covering a `width` × `height` image, row by row from the top left. */
export function tiles(
	width: number,
	height: number,
	maxSize = MAX_TILE_SIZE,
): Tile[] {
	const result: Tile[] = [];
	for (let y = 0; y < height; y += maxSize) {
		for (let x = 0; x < width; x += maxSize) {
			result.push({
				x,
				y,
				width: Math.min(maxSize, width - x),
				height: Math.min(maxSize, height - y),
			});
		}
	}
	return result;
}

/**
 * Map positions of a tile's corners, clockwise from the top left. The tile is in pixels, each
 * `unit` plan units (the transform's units).
 */
export function tileCorners(
	transform: Transform,
	tile: Tile,
	unit = 1,
): [LngLat, LngLat, LngLat, LngLat] {
	const x = tile.x * unit;
	const y = tile.y * unit;
	const right = (tile.x + tile.width) * unit;
	const bottom = (tile.y + tile.height) * unit;
	return [
		project(transform, [x, y]),
		project(transform, [right, y]),
		project(transform, [right, bottom]),
		project(transform, [x, bottom]),
	];
}

/** How far past its range, in halvings, a drawn pyramid level is kept while zooming. */
const LEVEL_MARGIN = 0.25;

/**
 * The pyramid level to draw (0: the full image, n: halved n times) for `imagePixels` image
 * pixels per screen pixel, among `levels`: the smallest one still having at least one pixel
 * per screen pixel. The level drawn now, `current`, is kept until the zoom is a quarter
 * halving past its range, so zooming across a boundary doesn't re-upload the plan back and
 * forth.
 */
export function pyramidLevel(
	imagePixels: number,
	levels: number,
	current?: number,
): number {
	const exact = Math.log2(imagePixels);
	if (!Number.isFinite(exact)) return 0;
	const last = Math.max(0, levels - 1);
	const clamp = (level: number) => Math.max(0, Math.min(last, level));
	if (
		current !== undefined &&
		exact >= current - LEVEL_MARGIN &&
		exact < current + 1 + LEVEL_MARGIN
	) {
		return clamp(current);
	}
	return clamp(Math.floor(exact));
}

/** A part of the map, in degrees. */
export interface Bounds {
	readonly west: number;
	readonly south: number;
	readonly east: number;
	readonly north: number;
}

/**
 * The tiles whose place on the map (the box around their corners) meets `bounds`, in their
 * order. Tiles are in pixels of `unit` plan units.
 */
export function visibleTiles<T extends { readonly tile: Tile }>(
	entries: readonly T[],
	transform: Transform,
	unit: number,
	bounds: Bounds,
): T[] {
	return entries.filter(({ tile }) => {
		const corners = tileCorners(transform, tile, unit);
		const lons = corners.map(([lon]) => lon);
		const lats = corners.map(([, lat]) => lat);
		return (
			Math.min(...lons) < bounds.east &&
			Math.max(...lons) > bounds.west &&
			Math.min(...lats) < bounds.north &&
			Math.max(...lats) > bounds.south
		);
	});
}
