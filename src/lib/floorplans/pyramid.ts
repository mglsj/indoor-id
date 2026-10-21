/**
 * Turns a decoded plan into what the map draws: the image at full size then halved again and
 * again, each level cut into tiles; then into what the store keeps: each tile encoded, and a
 * thumbnail for the list. Runs in the plan worker (`plan-worker.ts`); needs `OffscreenCanvas`
 * and `createImageBitmap`, no DOM.
 */
import { MessageError, msg } from "#lib/i18n/messages.ts";
import type { CutTile, EncodedImage, PlanImage, PlanLevel } from "./content.ts";
import { type ImageSize, imageSize } from "./image-size.ts";
import { type Tile, tiles } from "./tiling.ts";
import type { VectorContent } from "./vector.ts";

/** Longest side kept for a plan, in pixels; larger plans are scaled down on import. */
export const MAX_IMAGE_SIZE = 8192;
/**
 * Largest image decoded, in pixels (400 MB once decoded): its size is read from the header
 * first, as a file of a few KB can say 40,000 × 40,000.
 */
export const MAX_DECODED_PIXELS = 100_000_000;
/** The pyramid stops once a level fits in this many pixels. */
const SMALLEST_LEVEL = 256;
/** Longest side of a plan's thumbnail, in pixels. */
export const THUMBNAIL_SIZE = 128;

export type EncodeTile = (bitmap: ImageBitmap) => Promise<Blob>;

/** A plan image before its tiles are encoded. */
export type CutImage = Omit<PlanImage<CutTile>, "encoded">;

/**
 * Decodes a PNG, JPEG or WebP file, at most `MAX_IMAGE_SIZE` pixels wide or tall, into its
 * pyramid; with the size of the file's own pixels.
 */
export async function pyramidOfFile(
	file: Blob,
): Promise<{ image: CutImage; width: number; height: number }> {
	const header = imageSize(new Uint8Array(await file.arrayBuffer()));
	if (header && header.width * header.height > MAX_DECODED_PIXELS) {
		throw new MessageError(msg("plan_import_image_too_large"));
	}
	// Scaled while decoding when the header gives the size: the full image is never kept.
	const fit = header && fitted(header.width, header.height);
	const decoded = await createImageBitmap(
		file,
		fit
			? {
					resizeWidth: fit.width,
					resizeHeight: fit.height,
					resizeQuality: "high",
				}
			: {},
	).catch(() => {
		throw new MessageError(msg("plan_import_image_unreadable"));
	});
	const width = header?.width ?? decoded.width;
	const height = header?.height ?? decoded.height;
	const scaleTo = fitted(decoded.width, decoded.height);
	if (!scaleTo) return { image: await buildPyramid(decoded), width, height };
	const scaled = await createImageBitmap(decoded, {
		resizeWidth: scaleTo.width,
		resizeHeight: scaleTo.height,
		resizeQuality: "high",
	});
	decoded.close();
	return { image: await buildPyramid(scaled), width, height };
}

/** The size an image is scaled down to, or null when it fits `MAX_IMAGE_SIZE`. */
function fitted(width: number, height: number): ImageSize | null {
	const scale = MAX_IMAGE_SIZE / Math.max(width, height);
	if (scale >= 1) return null;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

/** The pyramid of a rendered drawing (an SVG, a PDF page). */
export function pyramidOfRendering(bitmap: ImageBitmap): Promise<CutImage> {
	return buildPyramid(bitmap);
}

/** Builds the pyramid of a decoded image (`bitmap` is used up). */
async function buildPyramid(bitmap: ImageBitmap): Promise<CutImage> {
	const { width, height } = bitmap;
	const levels: PlanLevel<CutTile>[] = [];
	let level: ImageBitmap | null = bitmap;
	for (let scale = 1; level; scale *= 2) {
		const current: ImageBitmap = level;
		level =
			Math.max(current.width, current.height) > SMALLEST_LEVEL
				? await createImageBitmap(current, {
						resizeWidth: Math.max(1, Math.round(current.width / 2)),
						resizeHeight: Math.max(1, Math.round(current.height / 2)),
						resizeQuality: "high",
					})
				: null;
		levels.push({ scale, tiles: cutLevel(current, width, height) });
	}
	return { width, height, levels };
}

/** Encodes every tile of an image, one at a time, and draws its thumbnail. */
export async function encodePyramid(
	image: CutImage,
	encode: EncodeTile,
): Promise<EncodedImage> {
	const levels: EncodedImage["levels"][number][] = [];
	for (const { scale, tiles } of image.levels) {
		const encoded: { tile: Tile; blob: Blob }[] = [];
		for (const { tile, bitmap } of tiles) {
			encoded.push({ tile, blob: await encode(bitmap) });
		}
		levels.push({ scale, tiles: encoded });
	}
	return { levels, thumbnail: await thumbnailOf(image) };
}

/**
 * Cuts one level into tiles, placed in the pixels of the full image (`width` × `height`). The
 * level's bitmap is used as is when it fits in one tile, else closed once cut.
 */
function cutLevel(
	bitmap: ImageBitmap,
	width: number,
	height: number,
): { tile: Tile; bitmap: ImageBitmap }[] {
	const fx = width / bitmap.width;
	const fy = height / bitmap.height;
	const parts = tiles(bitmap.width, bitmap.height);
	const full = (tile: Tile): Tile => ({
		x: tile.x * fx,
		y: tile.y * fy,
		width: tile.width * fx,
		height: tile.height * fy,
	});
	if (parts.length === 1) return [{ tile: full(parts[0] as Tile), bitmap }];
	// Each tile is copied through its own canvas: a cropped createImageBitmap may share the
	// source's pixels on GPU-accelerated browsers, and the source is closed right after.
	const result = parts.map((tile) => {
		const canvas = new OffscreenCanvas(tile.width, tile.height);
		const context = canvas.getContext("2d");
		if (!context) throw new Error("No 2D canvas");
		context.drawImage(
			bitmap,
			tile.x,
			tile.y,
			tile.width,
			tile.height,
			0,
			0,
			tile.width,
			tile.height,
		);
		return { tile: full(tile), bitmap: canvas.transferToImageBitmap() };
	});
	bitmap.close();
	return result;
}

/** A plan at most `THUMBNAIL_SIZE` pixels, drawn from its smallest level. */
async function thumbnailOf(image: CutImage): Promise<Blob> {
	const smallest = image.levels.at(-1);
	const scale = THUMBNAIL_SIZE / Math.max(image.width, image.height);
	const canvas = new OffscreenCanvas(
		Math.max(1, Math.round(image.width * scale)),
		Math.max(1, Math.round(image.height * scale)),
	);
	const context = canvas.getContext("2d");
	for (const { tile, bitmap } of smallest?.tiles ?? []) {
		context?.drawImage(
			bitmap,
			tile.x * scale,
			tile.y * scale,
			tile.width * scale,
			tile.height * scale,
		);
	}
	return canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
}

/** A vector plan at most `THUMBNAIL_SIZE` pixels: its fills, then its lines a pixel wide. */
export async function vectorThumbnail(vector: VectorContent): Promise<Blob> {
	const { width, height } = vector.size;
	const scale = THUMBNAIL_SIZE / Math.max(width, height);
	const canvas = new OffscreenCanvas(
		Math.max(1, Math.round(width * scale)),
		Math.max(1, Math.round(height * scale)),
	);
	const context = canvas.getContext("2d");
	if (context) {
		const css = (style: number) => {
			const [r, g, b, a] = vector.styles[style]?.color ?? [0, 0, 0, 255];
			return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
		};
		const t = vector.triangles;
		for (let i = 0; i < t.length / 6; i++) {
			context.fillStyle = css(vector.triangleStyles[i] ?? 0);
			context.beginPath();
			context.moveTo((t[i * 6] ?? 0) * scale, (t[i * 6 + 1] ?? 0) * scale);
			context.lineTo((t[i * 6 + 2] ?? 0) * scale, (t[i * 6 + 3] ?? 0) * scale);
			context.lineTo((t[i * 6 + 4] ?? 0) * scale, (t[i * 6 + 5] ?? 0) * scale);
			context.fill();
		}
		context.lineWidth = 1;
		const s = vector.segments;
		for (let i = 0; i < s.length / 4; i++) {
			context.strokeStyle = css(vector.segmentStyles[i] ?? 0);
			context.beginPath();
			context.moveTo((s[i * 4] ?? 0) * scale, (s[i * 4 + 1] ?? 0) * scale);
			context.lineTo((s[i * 4 + 2] ?? 0) * scale, (s[i * 4 + 3] ?? 0) * scale);
			context.stroke();
		}
	}
	return canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
}
