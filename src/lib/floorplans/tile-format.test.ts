import { describe, expect, it } from "vitest";
import { tileFormats } from "./tile-format.ts";

describe("tileFormats", () => {
	it("prefers JPEG XL where the browser decodes it, then WebP, then PNG", () => {
		expect(tileFormats({ decodesJxl: true, encodesWebp: true })).toEqual([
			"image/jxl",
			"image/webp",
			"image/png",
		]);
	});

	it("skips JPEG XL when the browser can't show it", () => {
		expect(tileFormats({ decodesJxl: false, encodesWebp: true })).toEqual([
			"image/webp",
			"image/png",
		]);
	});

	it("falls back to PNG when canvases don't write WebP", () => {
		expect(tileFormats({ decodesJxl: false, encodesWebp: false })).toEqual([
			"image/png",
		]);
		expect(tileFormats({ decodesJxl: true, encodesWebp: false })).toEqual([
			"image/jxl",
			"image/png",
		]);
	});
});
