import { afterAll, describe, expect, it } from "vitest";
import { MessageError } from "#lib/i18n/messages.ts";
import { workerCodec } from "./codec.ts";
import type { PlanImage } from "./content.ts";
import { VectorBuilder } from "./vector.ts";

const codec = workerCodec();
afterAll(() => codec.terminate());

/** A white picture with a dark frame and a red square in its top-left corner. */
function canvasOf(width: number, height: number): OffscreenCanvas {
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
	context.fillStyle = "#fff";
	context.fillRect(0, 0, width, height);
	context.strokeStyle = "#222";
	context.lineWidth = 4;
	context.strokeRect(2, 2, width - 4, height - 4);
	context.fillStyle = "#f00";
	context.fillRect(10, 10, 30, 30);
	return canvas;
}

const png = (width: number, height: number) =>
	canvasOf(width, height).convertToBlob({ type: "image/png" });

function pixels(
	source: ImageBitmap | OffscreenCanvas,
	x = 0,
	y = 0,
	width = source.width,
	height = source.height,
): Uint8ClampedArray {
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
	context.drawImage(source, -x, -y);
	return context.getImageData(0, 0, width, height).data;
}

/** Whether two pixel arrays match (`toEqual` takes seconds on megabytes). */
function same(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
	return a.length === b.length && a.every((value, i) => value === b[i]);
}

const scales = (image: PlanImage) => image.levels.map((l) => l.scale);

describe("workerCodec (the plan worker, in Chromium)", () => {
	it("cuts a file into a pyramid of tiles, then encodes them as lossless WebP", async () => {
		const file = await png(2400, 300);
		const { image, width, height } = await codec.decodeFile(file);
		expect([width, height, image.width, image.height]).toEqual([
			2400, 300, 2400, 300,
		]);
		// 2400, 1200, 600, 300 and 150 px wide: halved until 256 px or less.
		expect(scales(image)).toEqual([1, 2, 4, 8, 16]);
		const [left, right] = image.levels[0]?.tiles ?? [];
		expect(left?.tile).toEqual({ x: 0, y: 0, width: 2048, height: 300 });
		expect(right?.tile).toEqual({ x: 2048, y: 0, width: 352, height: 300 });
		const source = canvasOf(2400, 300);
		for (const part of [left, right]) {
			if (!part) throw new Error("missing tile");
			const { x, y, width: w, height: h } = part.tile;
			const expected = pixels(source, x, y, w, h);
			expect(same(pixels(part.bitmap), expected)).toBe(true);
		}
		// Encoded after: the plan shows first.
		const encoded = await image.encoded;
		expect(encoded.levels.map((l) => l.scale)).toEqual([1, 2, 4, 8, 16]);
		for (const { tile, blob } of encoded.levels[0]?.tiles ?? []) {
			expect(blob.type).toBe("image/webp");
			const expected = pixels(source, tile.x, tile.y, tile.width, tile.height);
			expect(same(pixels(await codec.decode(blob)), expected)).toBe(true);
		}
		// Placed in full-size pixels at every level.
		expect(image.levels[1]?.tiles.map((t) => t.tile)).toEqual([
			{ x: 0, y: 0, width: 2400, height: 300 },
		]);
	});

	it("draws a thumbnail of at most 128 px", async () => {
		const { image } = await codec.decodeFile(await png(2400, 300));
		const encoded = await image.encoded;
		if (!encoded.thumbnail) throw new Error("no thumbnail");
		const thumbnail = await createImageBitmap(encoded.thumbnail);
		expect([thumbnail.width, thumbnail.height]).toEqual([128, 16]);
	});

	it("scales a file over 8192 px down, giving its own size", async () => {
		const { image, width, height } = await codec.decodeFile(
			await png(9000, 90),
		);
		expect([width, height]).toEqual([9000, 90]);
		expect([image.width, image.height]).toEqual([8192, 82]);
		expect(image.levels[0]?.tiles.length).toBe(4);
	});

	it("cuts a rendering", async () => {
		const bitmap = canvasOf(400, 300).transferToImageBitmap();
		const image = await codec.fromRendering(bitmap);
		expect([image.width, image.height]).toEqual([400, 300]);
		expect(scales(image)).toEqual([1, 2]);
		const tile = image.levels[0]?.tiles[0]?.bitmap;
		if (!tile) throw new Error("no tile");
		expect(same(pixels(tile), pixels(canvasOf(400, 300)))).toBe(true);
	});

	it("draws a vector plan's thumbnail: its fills and lines in their colours", async () => {
		const builder = new VectorBuilder();
		builder.moveTo(0, 0);
		builder.lineTo(400, 0);
		builder.lineTo(400, 300);
		builder.lineTo(0, 300);
		builder.close();
		builder.fill({ color: [0, 0, 255, 255], width: 0, layer: null });
		const blob = await codec.vectorThumbnail(
			builder.build({ width: 400, height: 300 }),
		);
		const thumbnail = await createImageBitmap(blob);
		expect([thumbnail.width, thumbnail.height]).toEqual([128, 96]);
		const [r = 0, g = 0, b = 0] = pixels(thumbnail, 64, 48, 1, 1);
		expect([r, g, b].map((v) => Math.round(v / 16))).toEqual([0, 0, 16]);
	});

	it("reports a file it can't read with its message", async () => {
		const failure = await codec
			.decodeFile(new Blob(["not an image"], { type: "image/png" }))
			.catch((e: unknown) => e);
		expect(failure).toBeInstanceOf(MessageError);
		expect((failure as MessageError).msg).toEqual({
			key: "plan_import_image_unreadable",
		});
	});
});
