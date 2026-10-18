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
}

export interface LoadResult {
	/** Tiles that failed; they are retried on the next load. */
	readonly failed: number;
	/** True when the area was too large to load. */
	readonly skipped: boolean;
}

export class MapLoader {
	readonly #options: Required<MapLoaderOptions>;
	readonly #loaded = new Set<string>();
	readonly #pending = new Map<string, Promise<boolean>>();
	readonly #waiting: (() => void)[] = [];
	#active = 0;
	/** Entities downloaded but not handed over yet, and whether a frame is asked for. */
	#arrived: Entity[] = [];
	#scheduled = false;

	constructor(options: MapLoaderOptions) {
		this.#options = {
			...options,
			// Options given as undefined keep their default.
			zoom: options.zoom ?? 16,
			concurrency: options.concurrency ?? 4,
			maxTiles: options.maxTiles ?? 64,
			schedule: options.schedule ?? nextFrame,
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

	#loadTile(tile: Tile): Promise<boolean> {
		const key = `${tile.z}/${tile.x}/${tile.y}`;
		if (this.#loaded.has(key)) return Promise.resolve(true);
		const pending = this.#pending.get(key);
		if (pending) return pending;

		const loading = this.#limited(() =>
			this.#options.download(tileBounds(tile)),
		)
			.then(
				(entities) => {
					this.#loaded.add(key);
					this.#arrive(entities);
					return true;
				},
				() => false,
			)
			.finally(() => this.#pending.delete(key));
		this.#pending.set(key, loading);
		return loading;
	}

	#arrive(entities: Entity[]): void {
		for (const entity of entities) this.#arrived.push(entity);
		if (this.#scheduled) return;
		this.#scheduled = true;
		this.#options.schedule(() => this.#flush());
	}

	#flush(): void {
		this.#scheduled = false;
		if (this.#arrived.length === 0) return;
		const entities = this.#arrived;
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

function nextFrame(run: () => void): void {
	if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
	else setTimeout(run, 0);
}
