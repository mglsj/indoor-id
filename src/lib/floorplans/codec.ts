/**
 * How plan pixels become content and stored tiles become bitmaps again. An interface, so state
 * is tested without a browser; in the app, the work runs in the plan worker (`plan-worker.ts`).
 */
import { MessageError } from "#lib/i18n/messages.ts";
import type { CutTile, EncodedImage, PlanImage } from "./content.ts";
import type {
	WorkerError,
	WorkerRequest,
	WorkerResponse,
} from "./plan-worker.ts";
import type { CutImage } from "./pyramid.ts";
import type { VectorContent } from "./vector.ts";

export interface PlanCodec {
	/**
	 * A PNG, JPEG or WebP file decoded (at most `MAX_IMAGE_SIZE` pixels) and cut, its tiles
	 * encoded after; with the size of the file's own pixels.
	 */
	decodeFile(
		file: Blob,
	): Promise<{ image: PlanImage<CutTile>; width: number; height: number }>;
	/** A rendered drawing (an SVG, a PDF page) cut; `bitmap` is used up. */
	fromRendering(bitmap: ImageBitmap): Promise<PlanImage<CutTile>>;
	/** A stored tile, decoded. */
	decode(blob: Blob): Promise<ImageBitmap>;
	/** A small picture of a vector plan for the list. */
	vectorThumbnail(vector: VectorContent): Promise<Blob>;
}

interface Deferred<T> {
	resolve(value: T): void;
	reject(error: Error): void;
}

type Request = WorkerRequest extends infer R
	? R extends { id: number }
		? Omit<R, "id">
		: never
	: never;

/** A codec running in its own worker, started at the first call. */
export function workerCodec(): PlanCodec & { terminate(): void } {
	let worker: Worker | undefined;
	let next = 0;
	const answers = new Map<number, Deferred<unknown>>();
	const encodings = new Map<number, Deferred<EncodedImage>>();

	function failAll(error: Error) {
		for (const call of [...answers.values(), ...encodings.values()]) {
			call.reject(error);
		}
		answers.clear();
		encodings.clear();
	}

	function start(): Worker {
		const started = new Worker(new URL("./plan-worker.ts", import.meta.url), {
			type: "module",
		});
		started.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
			const { id } = data;
			if ("value" in data || "error" in data) {
				const call = answers.get(id);
				answers.delete(id);
				if ("value" in data) call?.resolve(data.value);
				else {
					call?.reject(errorOf(data.error));
					encodings.get(id)?.reject(errorOf(data.error));
					encodings.delete(id);
				}
			} else {
				const call = encodings.get(id);
				encodings.delete(id);
				if ("encoded" in data) call?.resolve(data.encoded);
				else call?.reject(errorOf(data.encodeError));
			}
		};
		started.onerror = (event) => {
			event.preventDefault();
			failAll(new Error(event.message || "Floor plan worker failed"));
		};
		return started;
	}

	function call<T>(request: Request, transfer: Transferable[] = []) {
		worker ??= start();
		const id = next++;
		const running = worker;
		const answer = new Promise<T>((resolve, reject) => {
			answers.set(id, { resolve: resolve as (value: unknown) => void, reject });
		});
		const encoded = new Promise<EncodedImage>((resolve, reject) => {
			if (request.op === "file" || request.op === "rendering") {
				encodings.set(id, { resolve, reject });
			}
		});
		// Handled where content is saved; a plan dropped before that leaves it unread.
		encoded.catch(() => {});
		running.postMessage({ id, ...request }, transfer);
		return { answer, encoded };
	}

	const withEncoded = (image: CutImage, encoded: Promise<EncodedImage>) => ({
		...image,
		encoded,
	});

	return {
		async decodeFile(file) {
			const { answer, encoded } = call<{
				image: CutImage;
				width: number;
				height: number;
			}>({ op: "file", file });
			const { image, width, height } = await answer;
			return { image: withEncoded(image, encoded), width, height };
		},
		async fromRendering(bitmap) {
			const { answer, encoded } = call<CutImage>({ op: "rendering", bitmap }, [
				bitmap,
			]);
			return withEncoded(await answer, encoded);
		},
		decode: (blob) => call<ImageBitmap>({ op: "decode", blob }).answer,
		vectorThumbnail: (vector) =>
			call<Blob>({ op: "vector-thumbnail", vector }).answer,
		terminate() {
			worker?.terminate();
			worker = undefined;
			failAll(new Error("Floor plan worker stopped"));
		},
	};
}

function errorOf(error: WorkerError): Error {
	return error.msg ? new MessageError(error.msg) : new Error(error.message);
}
