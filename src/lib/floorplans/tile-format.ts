/**
 * The format floor plan tiles are stored in, all lossless: JPEG XL is the smallest but only
 * worth writing where the browser shows it; WebP is next; PNG is written everywhere.
 */
export type TileFormat = "image/jxl" | "image/webp" | "image/png";

export interface FormatSupport {
	/** Whether the browser decodes JPEG XL images (the encoder is WASM, so always there). */
	readonly decodesJxl: boolean;
	/** Whether canvases write WebP (others give PNG instead). */
	readonly encodesWebp: boolean;
}

/** The formats to try, best first: a tile that fails to encode in one goes to the next. */
export function tileFormats({
	decodesJxl,
	encodesWebp,
}: FormatSupport): TileFormat[] {
	return [
		...(decodesJxl ? (["image/jxl"] as const) : []),
		...(encodesWebp ? (["image/webp"] as const) : []),
		"image/png",
	];
}
