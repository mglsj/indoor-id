/**
 * Downloads OSM data for the visible area in zoom-16 tiles: each tile once, a few at a time,
 * so panning back and forth never downloads the same data twice.
 */
import { type Tile, tileBounds, tilesCovering } from "#lib/map/tiles.ts";
import type { Entity } from "#lib/osm/entity.ts";
import type { Bbox } from "./osm-api.ts";

export interface MapLoaderOptions {
	/** Downloads one area, e.g. `(bbox) => api.loadMap(bbox)`. */
	readonly download: (bbox: Bbox) => Promise<Entity[]>;
	/**
	 * Receives downloaded entities: the tiles that arrived since the last call, at most once a
	 * frame, so loading a large area doesn't redraw the map after every tile.
	 */
	readonly onData: (entities: Entity[]) => void;
	/** Runs a function at the next frame (`requestAnimationFrame` by default). */
	readonly schedule?: (run: () => void) => void;
	readonly zoom?: number;
	readonly concurrency?: number;
	/** Areas needing more tiles are skipped: the view is zoomed out too far. */
	readonly maxTiles?: number;
	/**
	 * Whether a download failed because the area holds too much data (OSM's 400 for more than
	 * 50,000 nodes): the tile is then downloaded as its four quarters.
	 */
	readonly tooLarge?: (error: unknown) => boolean;
	/** Tiles aren't split past this zoom. */
	readonly maxSplitZoom?: number;
	/** The time in milliseconds (`Date.now` by default), for the backoff of failed tiles. */
	readonly now?: () => number;
}

/** The first wait before a failed tile is downloaded again, doubled after each failure. */
const FIRST_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;

export interface LoadResult {
	/** Tiles that failed; they are retried on the next load. */
	readonly failed: number;
	/** True when the area was too large to load. */
	readonly skipped: boolean;
}

export class MapLoader {
	readonly #options: Required<MapLoaderOptions>;
	readonly #loaded = new Set<string>();
	/** Tiles too large to download whole: their quarters are downloaded instead. */
	readonly #split = new Set<string>();
	/** Failed tiles, and when they may be downloaded again. */
	readonly #failures = new Map<string, { count: number; until: number }>();
	readonly #pending = new Map<string, Promise<boolean>>();
	readonly #waiting: (() => void)[] = [];
	#active = 0;
	/** Tiles downloaded but not handed over yet, and whether a frame is asked for. */
	#arrived: { key: string; entities: Entity[] }[] = [];
	#scheduled = false;
	/** Bumped by `reset`: answers to requests made before it are dropped. */
	#generation = 0;
	/** Resolves when `resume` is called; null while not paused. */
	#paused: Promise<void> | null = null;
	#resume: () => void = () => {};

	constructor(options: MapLoaderOptions) {
		this.#options = {
			...options,
			// Options given as undefined keep their default.
			zoom: options.zoom ?? 16,
			concurrency: options.concurrency ?? 4,
			maxTiles: options.maxTiles ?? 64,
			schedule: options.schedule ?? nextFrame,
			tooLarge: options.tooLarge ?? isBadRequest,
			maxSplitZoom: options.maxSplitZoom ?? 19,
			now: options.now ?? Date.now,
		};
	}

	async load(bounds: Bbox): Promise<LoadResult> {
		const tiles = tilesCovering(bounds, this.#options.zoom);
		if (tiles.length > this.#options.maxTiles)
			return { failed: 0, skipped: true };
		const results = await Promise.all(
			tiles.map((tile) => this.#loadTile(tile)),
		);
		// Everything is handed over once the load resolves.
		this.#flush();
		return { failed: results.filter((ok) => !ok).length, skipped: false };
	}

	/**
	 * Holds downloads (while uploading): none starts and nothing is handed over until `resume`.
	 * Answers to downloads already on their way are kept for then, unless `reset` drops them.
	 */
	pause(): void {
		if (this.#paused) return;
		this.#paused = new Promise((resolve) => {
			this.#resume = resolve;
		});
	}

	resume(): void {
		if (!this.#paused) return;
		this.#paused = null;
		this.#resume();
		this.#flush();
	}

	/**
	 * The data changed under the loader (an upload's new base): answers not handed over yet
	 * are dropped and their tiles downloaded again, now for those on their way, on the next
	 * load for the others.
	 */
	reset(): void {
		this.#generation++;
		for (const { key } of this.#arrived) this.#loaded.delete(key);
		this.#arrived = [];
	}

	#loadTile(tile: Tile): Promise<boolean> {
		const key = `${tile.z}/${tile.x}/${tile.y}`;
		if (this.#loaded.has(key)) return Promise.resolve(true);
		if (this.#split.has(key)) return this.#loadQuarters(tile);
		const pending = this.#pending.get(key);
		if (pending) return pending;
		// Failed lately: not asked again on every move.
		const failure = this.#failures.get(key);
		if (failure && this.#options.now() < failure.until) {
			return Promise.resolve(false);
		}

		const loading = this.#download(tile, key).finally(() =>
			this.#pending.delete(key),
		);
		this.#pending.set(key, loading);
		return loading;
	}

	async #download(tile: Tile, key: string): Promise<boolean> {
		for (;;) {
			let generation = this.#generation;
			let entities: Entity[];
			try {
				entities = await this.#limited(async () => {
					while (this.#paused) await this.#paused;
					generation = this.#generation;
					return this.#options.download(tileBounds(tile));
				});
			} catch (error) {
				if (generation !== this.#generation) continue;
				if (
					tile.z < this.#options.maxSplitZoom &&
					this.#options.tooLarge(error)
				) {
					this.#split.add(key);
					return this.#loadQuarters(tile);
				}
				const count = (this.#failures.get(key)?.count ?? 0) + 1;
				const wait = Math.min(
					FIRST_BACKOFF_MS * 2 ** (count - 1),
					MAX_BACKOFF_MS,
				);
				this.#failures.set(key, { count, until: this.#options.now() + wait });
				return false;
			}
			// Asked for before a reset: the answer may hold what the new base deleted.
			if (generation !== this.#generation) continue;
			this.#failures.delete(key);
			this.#loaded.add(key);
			this.#arrive(key, entities);
			return true;
		}
	}

	/** A tile too large, as its four quarters: true once all four are in. */
	async #loadQuarters({ x, y, z }: Tile): Promise<boolean> {
		const quarters = [0, 1].flatMap((dy) =>
			[0, 1].map((dx) => ({ x: 2 * x + dx, y: 2 * y + dy, z: z + 1 })),
		);
		const results = await Promise.all(
			quarters.map((quarter) => this.#loadTile(quarter)),
		);
		return results.every(Boolean);
	}

	#arrive(key: string, entities: Entity[]): void {
		this.#arrived.push({ key, entities });
		if (this.#scheduled) return;
		this.#scheduled = true;
		this.#options.schedule(() => this.#flush());
	}

	#flush(): void {
		this.#scheduled = false;
		if (this.#paused || this.#arrived.length === 0) return;
		const entities = this.#arrived.flatMap((tile) => tile.entities);
		this.#arrived = [];
		this.#options.onData(entities);
	}

	/** Runs `task` once fewer than `concurrency` tasks are running. */
	async #limited<T>(task: () => Promise<T>): Promise<T> {
		if (this.#active >= this.#options.concurrency) {
			await new Promise<void>((resolve) => this.#waiting.push(resolve));
		}
		this.#active++;
		try {
			return await task();
		} finally {
			this.#active--;
			this.#waiting.shift()?.();
		}
	}
}

function isBadRequest(error: unknown): boolean {
	return (error as { status?: unknown } | null)?.status === 400;
}

function nextFrame(run: () => void): void {
	if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
	else setTimeout(run, 0);
}
