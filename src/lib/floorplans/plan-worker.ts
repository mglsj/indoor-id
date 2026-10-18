/**
 * The plan worker: decoding, cutting and encoding floor plans off the main thread, so the map
 * stays smooth while a large plan is imported or loaded. Spoken to through `workerCodec()`
 * (`codec.ts`). A plan is answered twice: once cut, to be shown at once, then once its tiles
 * are encoded for storage, which takes longer.
 */
import { type Message, MessageError } from "#lib/i18n/messages.ts";
import type { EncodedImage } from "./content.ts";
import {
	type CutImage,
	encodePyramid,
	pyramidOfFile,
	pyramidOfRendering,
	vectorThumbnail,
} from "./pyramid.ts";
import { decodeTile, encodeTile, probeSupport } from "./tile-codec.ts";
import { tileFormats } from "./tile-format.ts";
import type { VectorContent } from "./vector.ts";

export type WorkerRequest = { readonly id: number } & (
	| { readonly op: "file"; readonly file: Blob }
	| { readonly op: "rendering"; readonly bitmap: ImageBitmap }
	| { readonly op: "decode"; readonly blob: Blob }
	| { readonly op: "vector-thumbnail"; readonly vector: VectorContent }
);

export interface WorkerError {
	readonly message: string;
	/** Set for a `MessageError`, which is rebuilt on the other side. */
	readonly msg?: Message;
}

export type WorkerResponse =
	| { readonly id: number; readonly value: unknown }
	| { readonly id: number; readonly error: WorkerError }
	/** The second answer to `file` and `rendering`. */
	| { readonly id: number; readonly encoded: EncodedImage }
	| { readonly id: number; readonly encodeError: WorkerError };

let formats: ReturnType<typeof probeFormats> | undefined;
async function probeFormats() {
	return tileFormats(await probeSupport());
}

async function encode(bitmap: ImageBitmap): Promise<Blob> {
	formats ??= probeFormats();
	return encodeTile(bitmap, await formats);
}

// Typed as a window (no worker types here): its postMessage takes the same options.
function post(response: WorkerResponse, transfer: Transferable[] = []): void {
	self.postMessage(response, { transfer });
}

function errorOf(e: unknown): WorkerError {
	return {
		message: (e as Error).message,
		...(e instanceof MessageError ? { msg: e.msg } : {}),
	};
}

/**
 * Sends a cut image, then encodes its tiles and sends them. The bitmaps are sent as copies, so
 * the plan shows while this side encodes its own; those are closed once encoded.
 */
async function answer(id: number, value: unknown, image: CutImage) {
	post({ id, value });
	try {
		post({ id, encoded: await encodePyramid(image, encode) });
	} catch (e) {
		post({ id, encodeError: errorOf(e) });
	} finally {
		for (const level of image.levels) {
			for (const { bitmap } of level.tiles) bitmap.close();
		}
	}
}

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
	try {
		switch (data.op) {
			case "file": {
				const value = await pyramidOfFile(data.file);
				await answer(data.id, value, value.image);
				break;
			}
			case "rendering": {
				const image = await pyramidOfRendering(data.bitmap);
				await answer(data.id, image, image);
				break;
			}
			case "vector-thumbnail":
				post({ id: data.id, value: await vectorThumbnail(data.vector) });
				break;
			case "decode": {
				const bitmap = await decodeTile(data.blob);
				post({ id: data.id, value: bitmap }, [bitmap]);
				break;
			}
		}
	} catch (e) {
		post({ id: data.id, error: errorOf(e) });
	}
};
