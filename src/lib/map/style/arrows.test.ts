import { describe, expect, it } from "vitest";
import { ARROW_IMAGE, arrowImage, BOTH_ARROWS_IMAGE } from "./arrows.ts";

/** The alpha at pixel x, y. */
const alpha = (
	image: NonNullable<ReturnType<typeof arrowImage>>,
	x: number,
	y: number,
) => image.data[(y * image.width + x) * 4 + 3] ?? 0;

describe("arrowImage", () => {
	it("draws a chevron pointing right, its tip at 70% across", () => {
		const image = arrowImage(ARROW_IMAGE, 2);
		if (!image) throw new Error("no image");
		expect([image.width, image.height]).toEqual([24, 24]);
		expect(image.data).toHaveLength(24 * 24 * 4);
		// The tip (16.8, 12) is drawn; the middle of its open side (7, 12) is not.
		expect(alpha(image, 16, 12)).toBe(255);
		expect(alpha(image, 7, 12)).toBe(0);
	});

	it("draws two chevrons pointing away from each other for both ways", () => {
		const image = arrowImage(BOTH_ARROWS_IMAGE);
		if (!image) throw new Error("no image");
		expect([image.width, image.height]).toEqual([24, 12]);
		// Tips at 3.6 and 20.4 px across.
		expect(alpha(image, 3, 6)).toBeGreaterThan(200);
		expect(alpha(image, 20, 6)).toBeGreaterThan(200);
	});

	it("knows only its own images", () => {
		expect(arrowImage("maki-toilet")).toBeNull();
	});
});
