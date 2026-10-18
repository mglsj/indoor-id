/**
 * Decoded tiles of stored raster plans, decoded when the map first shows them and kept within
 * a memory budget: past it, the tiles least recently used are dropped and their bitmaps
 * closed, never those on screen (`pin`). Tiles are keyed by their entry in the plan's content.
 */

/** How much memory decoded tiles take at most, in bytes (4 a pixel). */
export const TILE_BUDGET = 512 * 1024 * 1024;

/** What a tile decodes to: an `ImageBitmap` in the app. */
export interface DecodedTile {
	readonly width: number;
	readonly height: number;
	close(): void;
}

export class TileCache<B extends DecodedTile = ImageBitmap> {
	readonly #decode: (blob: Blob) => Promise<B>;
	readonly #budget: number;
	/** Decoded tiles, least recently used first (a Map keeps insertion order). */
	readonly #decoded = new Map<object, B>();
	readonly #decoding = new Map<object, Promise<B | undefined>>();
	#pinned = new Set<object>();
	#bytes = 0;

	constructor(decode: (blob: Blob) => Promise<B>, budget = TILE_BUDGET) {
		this.#decode = decode;
		this.#budget = budget;
	}

	/** Memory the decoded tiles take, in bytes. */
	get bytes(): number {
		return this.#bytes;
	}

	/** A tile's bitmap if decoded, marked as just used. */
	peek(key: object): B | undefined {
		const bitmap = this.#decoded.get(key);
		if (bitmap) {
			this.#decoded.delete(key);
			this.#decoded.set(key, bitmap);
		}
		return bitmap;
	}

	/** Decodes a tile once; undefined when it was forgotten while decoding. */
	load(key: object, blob: Blob): Promise<B | undefined> {
		const decoded = this.peek(key);
		if (decoded) return Promise.resolve(decoded);
		let decoding = this.#decoding.get(key);
		if (!decoding) {
			decoding = this.#decode(blob).then(
				(bitmap) => {
					// Forgotten meanwhile: nobody wants it.
					if (this.#decoding.get(key) !== decoding) {
						bitmap.close();
						return undefined;
					}
					this.#decoding.delete(key);
					this.#decoded.set(key, bitmap);
					this.#bytes += size(bitmap);
					// Kept for whoever asked, who may pin it next.
					this.#trim(key);
					return bitmap;
				},
				(error: unknown) => {
					if (this.#decoding.get(key) === decoding) this.#decoding.delete(key);
					throw error;
				},
			);
			this.#decoding.set(key, decoding);
		}
		return decoding;
	}

	/** The tiles on screen, replacing those given before: they are never dropped. */
	pin(keys: Iterable<object>): void {
		this.#pinned = new Set(keys);
		this.#trim();
	}

	/** Drops and closes these tiles (their plan's content is gone), decoded or decoding. */
	forget(keys: Iterable<object>): void {
		for (const key of keys) {
			this.#decoding.delete(key);
			this.#pinned.delete(key);
			const bitmap = this.#decoded.get(key);
			if (bitmap) this.#drop(key, bitmap);
		}
	}

	/**
	 * Drops the least recently used tiles not on screen (nor `spared`) until within the budget.
	 */
	#trim(spared?: object): void {
		for (const [key, bitmap] of this.#decoded) {
			if (this.#bytes <= this.#budget) return;
			if (key !== spared && !this.#pinned.has(key)) this.#drop(key, bitmap);
		}
	}

	#drop(key: object, bitmap: B): void {
		this.#decoded.delete(key);
		this.#bytes -= size(bitmap);
		bitmap.close();
	}
}

function size({ width, height }: DecodedTile): number {
	return width * height * 4;
}
