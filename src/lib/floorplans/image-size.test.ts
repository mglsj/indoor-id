import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { imageSize } from "./image-size.ts";

const fixture = (name: string) =>
	new Uint8Array(readFileSync(`tests/e2e/files/${name}`));

/** Bytes from text (one byte per character) and numbers. */
function bytes(...parts: (string | number[])[]): Uint8Array {
	return new Uint8Array(
		parts.flatMap((p) =>
			typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p,
		),
	);
}

describe("imageSize: a plan image's size from its header", () => {
	it("reads PNG, JPEG and WebP files (400 × 300, as `file` says)", () => {
		for (const name of ["plan.png", "plan.jpg", "plan.webp"]) {
			expect(imageSize(fixture(name))).toEqual({ width: 400, height: 300 });
		}
		expect(imageSize(fixture("stripes.png"))).toEqual({
			width: 4000,
			height: 3000,
		});
	});

	it("reads a 40,000 px square PNG from its 24 first bytes", () => {
		// IHDR: width and height as big-endian 32-bit numbers (40,000 = 0x9c40).
		const png = bytes(
			"\x89PNG\r\n\x1a\n",
			[0, 0, 0, 13],
			"IHDR",
			[0, 0, 0x9c, 0x40, 0, 0, 0x9c, 0x40],
		);
		expect(imageSize(png)).toEqual({ width: 40_000, height: 40_000 });
	});

	it("reads lossless and extended WebP headers", () => {
		// VP8L: signature 0x2f, then 14 bits of width - 1 and 14 bits of height - 1.
		// 640 × 480: 639 | 479 << 14 = 0x0077c27f.
		const lossless = bytes(
			"RIFF",
			[0, 0, 0, 0],
			"WEBPVP8L",
			[0, 0, 0, 0, 0x2f, 0x7f, 0xc2, 0x77, 0x00],
		);
		expect(imageSize(lossless)).toEqual({ width: 640, height: 480 });
		// VP8X: flags, 3 reserved bytes, then 24-bit width - 1 and height - 1 (20,000 × 10).
		const extended = bytes(
			"RIFF",
			[0, 0, 0, 0],
			"WEBPVP8X",
			[10, 0, 0, 0, 0x10, 0, 0, 0, 0x1f, 0x4e, 0, 9, 0, 0],
		);
		expect(imageSize(extended)).toEqual({ width: 20_000, height: 10 });
	});

	it("reads a GIF's logical screen", () => {
		expect(imageSize(bytes("GIF89a", [0x20, 0x03, 0x58, 0x02]))).toEqual({
			width: 800,
			height: 600,
		});
	});

	it("gives null for other or cut-short files", () => {
		expect(imageSize(bytes("<svg"))).toBeNull();
		expect(imageSize(bytes("\x89PNG\r\n\x1a\n"))).toBeNull();
		expect(imageSize(fixture("plan.jpg").subarray(0, 40))).toBeNull();
	});
});
