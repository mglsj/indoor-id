import { describe, expect, it } from "vitest";
import { decodeTile, encodeTile, probeSupport } from "./tile-codec.ts";

/** A plan-like picture: white, a grid of dark walls, red marks, a half-transparent corner. */
function picture(width: number, height: number): ImageBitmap {
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
	context.fillStyle = "#fff";
	context.fillRect(0, 0, width, height);
	context.fillStyle = "#141414";
	for (let x = 0; x < width; x += 37) context.fillRect(x, 0, 2, height);
	for (let y = 0; y < height; y += 23) context.fillRect(0, y, width, 3);
	context.fillStyle = "#c83c3c";
	context.fillRect(width / 3, height / 3, 11, 7);
	return canvas.transferToImageBitmap();
}

function pixels(bitmap: ImageBitmap): Uint8ClampedArray {
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
	context.drawImage(bitmap, 0, 0);
	return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
}

describe("tile codec (in Chromium)", () => {
	it("finds what the browser reads and writes", async () => {
		// Chromium writes WebP and, for now, doesn't read JPEG XL.
		expect(await probeSupport()).toEqual({
			decodesJxl: false,
			encodesWebp: true,
		});
	});

	it("writes lossless WebP", async () => {
		const tile = picture(300, 200);
		const blob = await encodeTile(tile, ["image/webp", "image/png"]);
		expect(blob.type).toBe("image/webp");
		const back = await decodeTile(blob);
		expect([back.width, back.height]).toEqual([300, 200]);
		expect(pixels(back)).toEqual(pixels(tile));
	});

	it("writes lossless JPEG XL, read back through WASM where the browser can't", async () => {
		const tile = picture(300, 200);
		const blob = await encodeTile(tile, ["image/jxl", "image/png"]);
		expect(blob.type).toBe("image/jxl");
		const back = await decodeTile(blob);
		expect([back.width, back.height]).toEqual([300, 200]);
		expect(pixels(back)).toEqual(pixels(tile));
	});

	it("falls back to the next format", async () => {
		// Canvases don't write JPEG XL: asked for it, a canvas gives PNG, which is not taken
		// as JPEG XL. Here the WASM encoder is skipped by listing a format canvases lack.
		const blob = await encodeTile(picture(10, 10), [
			"image/avif" as "image/png",
			"image/png",
		]);
		expect(blob.type).toBe("image/png");
	});
});
