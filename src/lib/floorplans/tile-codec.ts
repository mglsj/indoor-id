/**
 * Plan tiles to stored files and back, lossless (see `tile-format.ts` for the choice of format).
 * Runs in the plan worker; needs `OffscreenCanvas` and `createImageBitmap`, no DOM.
 */
import { decodeJxl, encodeJxl } from "./jxl.ts";
import type { FormatSupport, TileFormat } from "./tile-format.ts";

/** A 1 × 1 lossless JPEG XL image: the browser decodes JPEG XL if it decodes this. */
const JXL_SAMPLE = "/woAELASCAgQAEAASxKlQoUk1sjx2w5Azr/zAQ==";

/** What this browser reads and writes. */
export async function probeSupport(): Promise<FormatSupport> {
	const sample = Uint8Array.from(atob(JXL_SAMPLE), (c) => c.charCodeAt(0));
	const canvas = new OffscreenCanvas(1, 1);
	canvas.getContext("2d");
	const [decodesJxl, webp] = await Promise.all([
		createImageBitmap(new Blob([sample], { type: "image/jxl" })).then(
			(bitmap) => {
				bitmap.close();
				return true;
			},
			() => false,
		),
		canvas.convertToBlob({ type: "image/webp" }),
	]);
	return { decodesJxl, encodesWebp: webp.type === "image/webp" };
}

/** Encodes a tile in the first of `formats` that works. */
export async function encodeTile(
	bitmap: ImageBitmap,
	formats: readonly TileFormat[],
): Promise<Blob> {
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const context = canvas.getContext("2d");
	if (!context) throw new Error("No 2D canvas");
	context.drawImage(bitmap, 0, 0);
	let failure: unknown;
	for (const format of formats) {
		try {
			const blob =
				format === "image/jxl"
					? await encodeJxl(
							context.getImageData(0, 0, canvas.width, canvas.height),
						)
					: // Quality 1 asks for lossless WebP.
						await canvas.convertToBlob({ type: format, quality: 1 });
			// A canvas asked for a format it doesn't write gives PNG.
			if (blob.type === format) return blob;
		} catch (e) {
			failure = e;
		}
	}
	throw failure ?? new Error("No tile format could be written");
}

/** Decodes a stored tile; JPEG XL through WASM where the browser doesn't (or no longer) read it. */
export async function decodeTile(blob: Blob): Promise<ImageBitmap> {
	try {
		return await createImageBitmap(blob);
	} catch (e) {
		if (blob.type !== "image/jxl") throw e;
		return createImageBitmap(await decodeJxl(blob));
	}
}
