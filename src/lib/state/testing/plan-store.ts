/** Floor plan tests: a store in memory and a codec without a browser. */
import type { PlanCodec } from "#lib/floorplans/codec.ts";
import type { CutTile, PlanImage } from "#lib/floorplans/content.ts";
import type { VectorContent } from "#lib/floorplans/vector.ts";
import {
	fileOf,
	type PlanStore,
	type StoredBuildings,
	type StoredContent,
	type StoredPlan,
} from "#lib/persist/plan-store.ts";

/** A store keeping the latest of each record, like IndexedDB, to restore from. */
export function memoryStore() {
	const plans = new Map<string, StoredPlan>();
	const contents = new Map<string, StoredContent>();
	const thumbnails = new Map<string, Blob>();
	const files = new Map<string, Blob>();
	const vectors = new Map<string, VectorContent>();
	/** Every plan saved, in order. */
	const saved: StoredPlan[] = [];
	let buildings: StoredBuildings | undefined;
	const store: PlanStore = {
		load: async () => [...plans.values()].sort((a, b) => a.order - b.order),
		loadContent: async (id) => contents.get(id),
		saveContent: async (id, content) => {
			contents.set(id, content);
			if (content.thumbnail) thumbnails.set(id, content.thumbnail);
		},
		loadVector: async (id) => vectors.get(id),
		saveVector: async (id, content, thumbnail) => {
			vectors.set(id, content);
			if (thumbnail) thumbnails.set(id, thumbnail);
		},
		saveFile: async (id, file) => {
			files.set(id, file);
		},
		loadFile: async (id) => files.get(id),
		loadThumbnails: async () => new Map(thumbnails),
		save: async (plan) => {
			plans.set(plan.id, plan);
			saved.push(plan);
		},
		delete: async (id) => {
			const deleting = plans.get(id);
			plans.delete(id);
			vectors.delete(id);
			const file = deleting ? fileOf(deleting) : id;
			if (![...plans.values()].some((p) => fileOf(p) === file)) {
				files.delete(file);
			}
			contents.delete(id);
			thumbnails.delete(id);
		},
		loadBuildings: async () => buildings,
		saveBuildings: async (b) => {
			buildings = b;
		},
		saveStack: async (stack, b) => {
			for (const plan of stack) plans.set(plan.id, plan);
			buildings = b;
		},
	};
	return { store, plans, contents, files, vectors, saved };
}

/** A bitmap stand-in: its size, and whether it was closed. */
export function fakeBitmap(width = 400, height = 300) {
	const bitmap = {
		width,
		height,
		closed: false,
		close() {
			bitmap.closed = true;
		},
	};
	return bitmap as unknown as ImageBitmap & { closed: boolean };
}

/** A 400 × 300 image in one tile, encoded as its size in text, with a thumbnail. */
export function fakeImage(): PlanImage<CutTile> {
	const tile = { x: 0, y: 0, width: 400, height: 300 };
	return {
		width: 400,
		height: 300,
		levels: [{ scale: 1, tiles: [{ tile, bitmap: fakeBitmap() }] }],
		encoded: Promise.resolve({
			levels: [
				{ scale: 1, tiles: [{ tile, blob: new Blob(["tile 400×300"]) }] },
			],
			thumbnail: new Blob(["thumbnail"]),
		}),
	};
}

/** Every file is a 400 × 300 image; stored tiles decode into stand-in bitmaps. */
export const fakeCodec: PlanCodec = {
	decodeFile: async () => ({ image: fakeImage(), width: 400, height: 300 }),
	fromRendering: async () => fakeImage(),
	decode: async () => fakeBitmap(),
	vectorThumbnail: async () => new Blob(["vector thumbnail"]),
};
