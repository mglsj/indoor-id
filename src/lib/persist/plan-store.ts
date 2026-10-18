/**
 * Floor plans kept in the browser's IndexedDB, so they survive reloads. Settings, content and
 * thumbnails are stored apart: settings change with every slider move, content is written once
 * and read only for the plans shown, thumbnails are read for the list. Nothing leaves the
 * user's browser.
 *
 * Schema 4: `plans` (settings), `rasters` (a plan's raster: unit, size, the tiles of each
 * pyramid level), `tiles` (`[plan, level, x, y]` → the encoded tile), `originals` (the files
 * plans were imported from, by file id: a PDF once for all its pages; a plan saved without a
 * `source` has its file under its own id), `thumbnails`, `settings` (the building outlines'
 * place), `vectors` (a vector plan's paths, added in schema 4). `images` holds the whole images of schemas 1 and 2 until each plan is converted, the
 * first time its content loads.
 */
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { PlanSize, PlanSource } from "#lib/floorplans/content.ts";
import type {
	ControlPoint,
	Transform,
	TransformKind,
} from "#lib/floorplans/georef.ts";
import type { Tile } from "#lib/floorplans/tiling.ts";
import type { VectorContent } from "#lib/floorplans/vector.ts";

/** A plan's settings: everything but its content. */
export interface StoredPlan {
	readonly id: string;
	readonly name: string;
	/** Size in plan units; plans saved before plan units have none (their image's pixels). */
	readonly size?: PlanSize;
	/** The file it was imported from; plans saved before R2.4 have none (see `fileOf`). */
	readonly source?: PlanSource;
	readonly transform: Transform;
	readonly controlPoints: readonly ControlPoint[];
	readonly fitKind: TransformKind;
	readonly opacity: number;
	readonly level: string | null;
	readonly visible: boolean;
	/** Ids of the CAD layers not shown; plans saved before layers could be hidden have none. */
	readonly hiddenLayers?: readonly string[];
	/** `#rrggbb`; plans saved before colours existed have none. */
	readonly color?: string;
	/** Place in the layer stack, the building outlines included: lowest first. */
	readonly order: number;
}

/** The building outlines' place in the layer stack (same scale as plans' `order`). */
export interface StoredBuildings {
	readonly order: number;
	readonly visible: boolean;
}

/** A raster as stored: each pyramid level's tiles, encoded, placed in full-size pixels. */
export interface StoredRaster {
	/** Plan units per pixel of the full-size image. */
	readonly unit: number;
	readonly width: number;
	readonly height: number;
	readonly levels: readonly {
		/** Image pixels per pixel of this level: 1, 2, 4… */
		readonly scale: number;
		readonly tiles: readonly { readonly tile: Tile; readonly blob: Blob }[];
	}[];
}

/** A plan's content as stored, or the whole image a plan saved before schema 3 still has. */
export type StoredContent =
	| {
			readonly kind: "raster";
			readonly raster: StoredRaster;
			/** The file imported (a PDF, an SVG, a photo), for exports. */
			readonly original?: Blob;
			readonly thumbnail?: Blob;
	  }
	| { readonly kind: "legacy"; readonly image: Blob };

/** Where plans are saved; an interface so that state can run without IndexedDB. */
export interface PlanStore {
	/** Saved plans' settings, in drawing order. */
	load(): Promise<StoredPlan[]>;
	/** A plan's content; undefined when it has none (saving failed). */
	loadContent(id: string): Promise<StoredContent | undefined>;
	/** Writes a plan's content, replacing any (an old image included). */
	saveContent(
		id: string,
		content: Extract<StoredContent, { kind: "raster" }>,
	): Promise<void>;
	/** A plan's vector content; undefined when it has none. */
	loadVector(id: string): Promise<VectorContent | undefined>;
	saveVector(
		id: string,
		content: VectorContent,
		thumbnail?: Blob,
	): Promise<void>;
	/** Saves a file plans were imported from, by its id. */
	saveFile(id: string, file: Blob): Promise<void>;
	loadFile(id: string): Promise<Blob | undefined>;
	/** Every plan's thumbnail, by id. */
	loadThumbnails(): Promise<Map<string, Blob>>;
	save(plan: StoredPlan): Promise<void>;
	/** Deletes a plan, its content, and its file unless another plan comes from it. */
	delete(id: string): Promise<void>;
	/** Undefined until the outlines were first moved or hidden. */
	loadBuildings(): Promise<StoredBuildings | undefined>;
	saveBuildings(buildings: StoredBuildings): Promise<void>;
	/** Saves several plans and the outlines' place at once (a reorder), in one write. */
	saveStack(
		plans: readonly StoredPlan[],
		buildings: StoredBuildings,
	): Promise<void>;
}

/** A raster's description as stored, its tiles apart. */
interface RasterRecord {
	readonly unit: number;
	readonly width: number;
	readonly height: number;
	readonly levels: readonly { scale: number; tiles: readonly Tile[] }[];
}

type TileKey = [plan: string, level: number, x: number, y: number];

interface Schema extends DBSchema {
	plans: { key: string; value: StoredPlan };
	rasters: { key: string; value: RasterRecord };
	tiles: { key: TileKey; value: Blob };
	originals: { key: string; value: Blob };
	thumbnails: { key: string; value: Blob };
	settings: { key: string; value: StoredBuildings };
	vectors: { key: string; value: VectorContent };
	/** Schemas 1 and 2: whole images, until converted. */
	images: { key: string; value: Blob };
}

/** The id of the file a plan comes from: its own id when saved without a source. */
export function fileOf(plan: StoredPlan): string {
	return plan.source?.file ?? plan.id;
}

/** Every tile key of a plan: arrays sort after numbers, so `[id, []]` is past them all. */
const tilesOf = (id: string) => IDBKeyRange.bound([id], [id, []]);

const CONTENT_STORES = [
	"rasters",
	"tiles",
	"thumbnails",
	"images",
	"vectors",
] as const;

export class IndexedDbPlanStore implements PlanStore {
	readonly #name: string;
	#db: Promise<IDBPDatabase<Schema>> | undefined;

	constructor(name = "indoorid-floorplans") {
		this.#name = name;
	}

	#open(): Promise<IDBPDatabase<Schema>> {
		this.#db ??= openDB<Schema>(this.#name, 4, {
			// Each store is made if missing, whatever version the database says it is at:
			// version 2 added "settings", version 3 the content stores. "images" stays for the
			// plans not converted yet; version 4 added "vectors".
			upgrade(db) {
				const stores = db.objectStoreNames;
				if (!stores.contains("plans")) {
					db.createObjectStore("plans", { keyPath: "id" });
				}
				for (const store of [
					"images",
					"settings",
					"rasters",
					"tiles",
					"originals",
					"thumbnails",
					"vectors",
				] as const) {
					if (!stores.contains(store)) db.createObjectStore(store);
				}
			},
		});
		return this.#db;
	}

	async load(): Promise<StoredPlan[]> {
		const plans = await (await this.#open()).getAll("plans");
		return plans.sort((a, b) => a.order - b.order);
	}

	async loadContent(id: string): Promise<StoredContent | undefined> {
		const db = await this.#open();
		const tx = db.transaction(
			["rasters", "tiles", "thumbnails", "images"],
			"readonly",
		);
		const record = await tx.objectStore("rasters").get(id);
		if (!record) {
			const image = await tx.objectStore("images").get(id);
			return image ? { kind: "legacy", image } : undefined;
		}
		const tiles = tx.objectStore("tiles");
		const levels = await Promise.all(
			record.levels.map(async ({ scale, tiles: placed }, level) => ({
				scale,
				tiles: await Promise.all(
					placed.map(async (tile) => ({
						tile,
						blob: (await tiles.get([id, level, tile.x, tile.y])) ?? new Blob(),
					})),
				),
			})),
		);
		const thumbnail = await tx.objectStore("thumbnails").get(id);
		return {
			kind: "raster",
			raster: { ...record, levels },
			...(thumbnail ? { thumbnail } : {}),
		};
	}

	async saveContent(
		id: string,
		{ raster, thumbnail }: Extract<StoredContent, { kind: "raster" }>,
	): Promise<void> {
		const db = await this.#open();
		const tx = db.transaction(CONTENT_STORES, "readwrite");
		const writes: Promise<unknown>[] = [
			tx.objectStore("tiles").delete(tilesOf(id)),
			tx.objectStore("images").delete(id),
			tx.objectStore("rasters").put(
				{
					unit: raster.unit,
					width: raster.width,
					height: raster.height,
					levels: raster.levels.map(({ scale, tiles }) => ({
						scale,
						tiles: tiles.map(({ tile }) => tile),
					})),
				},
				id,
			),
		];
		raster.levels.forEach(({ tiles }, level) => {
			for (const { tile, blob } of tiles) {
				writes.push(
					tx.objectStore("tiles").put(blob, [id, level, tile.x, tile.y]),
				);
			}
		});
		if (thumbnail) writes.push(tx.objectStore("thumbnails").put(thumbnail, id));
		await Promise.all([...writes, tx.done]);
	}

	async loadVector(id: string): Promise<VectorContent | undefined> {
		const vector = await (await this.#open()).get("vectors", id);
		// Saved before text was read: none.
		return vector && { ...vector, texts: vector.texts ?? [] };
	}

	async saveVector(
		id: string,
		content: VectorContent,
		thumbnail?: Blob,
	): Promise<void> {
		const db = await this.#open();
		const tx = db.transaction(["vectors", "thumbnails"], "readwrite");
		await Promise.all([
			tx.objectStore("vectors").put(content, id),
			...(thumbnail ? [tx.objectStore("thumbnails").put(thumbnail, id)] : []),
			tx.done,
		]);
	}

	async saveFile(id: string, file: Blob): Promise<void> {
		await (await this.#open()).put("originals", file, id);
	}

	async loadFile(id: string): Promise<Blob | undefined> {
		return (await this.#open()).get("originals", id);
	}

	async loadThumbnails(): Promise<Map<string, Blob>> {
		const db = await this.#open();
		const tx = db.transaction("thumbnails", "readonly");
		const [keys, values] = await Promise.all([
			tx.store.getAllKeys(),
			tx.store.getAll(),
		]);
		return new Map(keys.map((key, i) => [key, values[i] as Blob]));
	}

	async save(plan: StoredPlan): Promise<void> {
		await (await this.#open()).put("plans", plan);
	}

	async loadBuildings(): Promise<StoredBuildings | undefined> {
		return (await this.#open()).get("settings", "buildings");
	}

	async saveBuildings(buildings: StoredBuildings): Promise<void> {
		await (await this.#open()).put("settings", buildings, "buildings");
	}

	async saveStack(
		plans: readonly StoredPlan[],
		buildings: StoredBuildings,
	): Promise<void> {
		const db = await this.#open();
		const tx = db.transaction(["plans", "settings"], "readwrite");
		await Promise.all([
			...plans.map((plan) => tx.objectStore("plans").put(plan)),
			tx.objectStore("settings").put(buildings, "buildings"),
			tx.done,
		]);
	}

	async delete(id: string): Promise<void> {
		const db = await this.#open();
		const tx = db.transaction(
			["plans", "originals", ...CONTENT_STORES],
			"readwrite",
		);
		const plans = tx.objectStore("plans");
		const deleting = await plans.get(id);
		const others = (await plans.getAll()).filter((plan) => plan.id !== id);
		const file = deleting ? fileOf(deleting) : id;
		await Promise.all([
			plans.delete(id),
			tx.objectStore("tiles").delete(tilesOf(id)),
			...(["rasters", "thumbnails", "images", "vectors"] as const).map(
				(store) => tx.objectStore(store).delete(id),
			),
			...(others.some((plan) => fileOf(plan) === file)
				? []
				: [tx.objectStore("originals").delete(file)]),
			tx.done,
		]);
	}
}
