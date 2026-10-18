/**
 * What a floor plan shows, apart from where it is placed: its size in plan units and the
 * content drawn over that size. Plan units are the file's own: PDF points, SVG user units, a
 * photo's or scan's pixels. A plan's transform maps plan units, so rendering a PDF at another
 * DPI moves nothing. Content (tiles, paths) stays out of the reactive plan list: it is large,
 * and loaded only for the plans shown.
 */
import type { Tile } from "./tiling.ts";
import type { VectorContent } from "./vector.ts";

/**
 * The file a plan was imported from, by id (stored once, shared by the pages of one PDF):
 * the plan's content is drawn from it again when a plan file is read.
 */
export type PlanSource =
	| { readonly kind: "raster"; readonly file: string }
	| { readonly kind: "svg"; readonly file: string; readonly mode?: PlanMode }
	| {
			readonly kind: "pdf";
			readonly file: string;
			/** From 1. */
			readonly page: number;
			/** Dots per inch it is rendered at, as an image. */
			readonly dpi: number;
			readonly mode?: PlanMode;
	  };

/** How a drawing (PDF page, SVG) is drawn: from its paths, or as an image; image when unset. */
export type PlanMode = "vector" | "image";

/** A new plan's source, with its file (saved once per file id). */
export interface PlanOrigin {
	readonly source: PlanSource;
	readonly file: Blob;
}

/** A size in plan units. */
export interface PlanSize {
	readonly width: number;
	readonly height: number;
}

/** A plan's pixels, cut into tiles at several scales. */
export interface PlanImage<T extends PlanTile = PlanTile> {
	readonly width: number;
	readonly height: number;
	/**
	 * The image at full size, then halved again and again: the map draws the level matching the
	 * zoom. MapLibre doesn't mipmap image sources, so a large plan drawn small would otherwise
	 * lose its thin lines between the pixels it samples.
	 */
	readonly levels: readonly PlanLevel<T>[];
	/**
	 * The tiles as stored, and a thumbnail: encoded in the plan worker while the plan is already
	 * shown (lossless JPEG XL takes about half a second a tile).
	 */
	readonly encoded: Promise<EncodedImage>;
}

export interface PlanLevel<T extends PlanTile = PlanTile> {
	/** Image pixels per pixel of this level: 1, 2, 4… */
	readonly scale: number;
	/** The level cut into GPU-sized tiles, placed in full-size image pixels. */
	readonly tiles: readonly T[];
}

/**
 * A tile's pixels: decoded, as cut from a plan just imported, or encoded, as stored, decoded
 * when the map shows it (`TileCache`).
 */
export type PlanTile = CutTile | StoredTile;

export interface CutTile {
	readonly tile: Tile;
	readonly bitmap: ImageBitmap;
	readonly blob?: undefined;
}

export interface StoredTile {
	readonly tile: Tile;
	readonly blob: Blob;
	readonly bitmap?: undefined;
}

/** A plan image's tiles encoded for storage (lossless), level by level as in `levels`. */
export interface EncodedImage {
	readonly levels: readonly {
		readonly scale: number;
		readonly tiles: readonly { readonly tile: Tile; readonly blob: Blob }[];
	}[];
	/** A small picture of the plan for the list; plans stored without one have none. */
	readonly thumbnail?: Blob;
}

export interface RasterContent {
	/** Plan units per pixel of the full-size image (72/DPI for a PDF page, 1 for a photo). */
	readonly unit: number;
	readonly image: PlanImage;
}

export interface PlanContent {
	readonly size: PlanSize;
	readonly raster?: RasterContent;
	/** Its paths, drawn by the GPU at any zoom (P4.2). */
	readonly vector?: VectorContent;
}

/** Content drawn from paths, measured as they are. */
export function vectorContent(vector: VectorContent): PlanContent {
	return { size: vector.size, vector };
}

/**
 * Content drawn from pixels over `size` plan units (the image's own pixels when not given: a
 * photo, a scan, or a plan saved before plan units).
 */
export function rasterContent(image: PlanImage, size?: PlanSize): PlanContent {
	const planSize = size ?? { width: image.width, height: image.height };
	return {
		size: planSize,
		raster: { unit: planSize.width / image.width, image },
	};
}

/** A content's tiles, every level's. */
export function tilesOf(content: PlanContent | undefined): PlanTile[] {
	return (content?.raster?.image.levels ?? []).flatMap((l) => l.tiles);
}

/** Frees a content's cut bitmaps (a plan removed or its content dropped). */
export function closeContent(content: PlanContent | undefined): void {
	for (const { bitmap } of tilesOf(content)) bitmap?.close();
}
