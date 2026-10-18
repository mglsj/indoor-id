import { describe, expect, it } from "vitest";
import { type PlanImage, rasterContent } from "./content.ts";

/** An A4 page rendered at 150 DPI: 1240 × 1754 px. */
const page: PlanImage = {
	width: 1240,
	height: 1754,
	levels: [],
	encoded: Promise.resolve({ levels: [] }),
};

describe("rasterContent: a plan drawn from pixels, measured in its own units", () => {
	it("measures a PDF page in points, its pixels a fraction of one", () => {
		// A4 is 595.28 × 841.89 pt; 1240 px over 595.28 pt is 72/150 pt per pixel.
		const content = rasterContent(page, { width: 595.28, height: 841.89 });
		expect(content.size).toEqual({ width: 595.28, height: 841.89 });
		expect(content.raster?.unit).toBeCloseTo(72 / 150, 3);
		expect(content.raster?.image).toBe(page);
	});

	it("measures a photo or a scan in its own pixels", () => {
		const content = rasterContent(page);
		expect(content.size).toEqual({ width: 1240, height: 1754 });
		expect(content.raster?.unit).toBe(1);
	});
});
