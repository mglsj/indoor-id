/**
 * JPEG XL through WASM (libjxl, as packaged by jSquash): canvases don't write JPEG XL, and
 * browsers that once read it may stop. Each half is downloaded the first time it is needed.
 */

interface Pixels {
	readonly data: Uint8ClampedArray;
	readonly width: number;
	readonly height: number;
}

interface Encoder {
	encode(
		data: Uint8ClampedArray,
		width: number,
		height: number,
		options: Record<string, number | boolean>,
	): Uint8Array | null;
}

interface Decoder {
	decode(data: BufferSource): ImageData | null;
}

type Factory<T> = (options: {
	noInitialRun: boolean;
	locateFile: () => string;
}) => Promise<T>;

/**
 * Lossless, at effort 2: on plans, effort 3 and up shrink tiles further but take two to four
 * times longer (a 2048 px tile takes about 0.6 s at effort 2 on one core).
 */
const LOSSLESS = {
	lossless: true,
	quality: 100,
	effort: 2,
	progressive: false,
	epf: -1,
	lossyPalette: false,
	decodingSpeedTier: 0,
	photonNoiseIso: 0,
	lossyModular: false,
};

let encoder: Promise<Encoder> | undefined;
let decoder: Promise<Decoder> | undefined;

// The single-threaded builds, loaded with their WASM's URL from the bundler: the threaded ones
// need a cross-origin isolated page.
async function load<T>(
	module: Promise<{ default: unknown }>,
	wasm: Promise<{ default: string }>,
): Promise<T> {
	const [{ default: factory }, { default: url }] = await Promise.all([
		module,
		wasm,
	]);
	return (factory as Factory<T>)({ noInitialRun: true, locateFile: () => url });
}

/** Encodes pixels as a lossless JPEG XL file. */
export async function encodeJxl(pixels: Pixels): Promise<Blob> {
	encoder ??= load<Encoder>(
		import("@jsquash/jxl/codec/enc/jxl_enc.js"),
		import("@jsquash/jxl/codec/enc/jxl_enc.wasm?url"),
	);
	const bytes = (await encoder).encode(
		pixels.data,
		pixels.width,
		pixels.height,
		LOSSLESS,
	);
	if (!bytes) throw new Error("JPEG XL encoding failed");
	return new Blob([new Uint8Array(bytes)], { type: "image/jxl" });
}

/** Decodes a JPEG XL file, for browsers that don't. */
export async function decodeJxl(blob: Blob): Promise<ImageData> {
	decoder ??= load<Decoder>(
		import("@jsquash/jxl/codec/dec/jxl_dec.js"),
		import("@jsquash/jxl/codec/dec/jxl_dec.wasm?url"),
	);
	const image = (await decoder).decode(await blob.arrayBuffer());
	if (!image) throw new Error("JPEG XL decoding failed");
	return image;
}
