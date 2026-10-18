import { describe, expect, it } from "vitest";
import { TILE_BUDGET, TileCache } from "./tile-cache.ts";

/** A decoded tile of `side` × `side` px: 4 bytes a pixel. */
class FakeBitmap {
	closed = false;
	constructor(
		readonly width: number,
		readonly height: number,
		readonly name: string,
	) {}
	close() {
		this.closed = true;
	}
}

/** A cache of 10 × 10 px tiles (400 bytes each) holding `tiles` of them. */
function cache(tiles: number) {
	const decoded: string[] = [];
	const pending = new Map<string, () => void>();
	let paused = false;
	const tileCache = new TileCache<FakeBitmap>(async (blob) => {
		const name = await blob.text();
		decoded.push(name);
		if (paused) await new Promise<void>((go) => pending.set(name, go));
		return new FakeBitmap(10, 10, name);
	}, tiles * 400);
	return {
		tileCache,
		decoded,
		pause: () => {
			paused = true;
		},
		resume: (name: string) => pending.get(name)?.(),
	};
}

const key = (name: string) => ({ name, blob: new Blob([name]) });

describe("TileCache", () => {
	it("keeps 512 MB of decoded tiles at most, by default", () => {
		expect(TILE_BUDGET).toBe(512 * 1024 * 1024);
	});

	it("decodes a tile once, even when asked again while decoding", async () => {
		const { tileCache, decoded } = cache(4);
		const a = key("a");
		expect(tileCache.peek(a)).toBeUndefined();
		const [first, second] = await Promise.all([
			tileCache.load(a, a.blob),
			tileCache.load(a, a.blob),
		]);
		expect(first).toBe(second);
		expect(tileCache.peek(a)).toBe(first);
		await tileCache.load(a, a.blob);
		expect(decoded).toEqual(["a"]);
	});

	it("drops and closes the tiles least recently used past its budget", async () => {
		const { tileCache } = cache(3);
		const [a, b, c, d] = ["a", "b", "c", "d"].map(key);
		if (!a || !b || !c || !d) throw new Error("no keys");
		const bitmapA = await tileCache.load(a, a.blob);
		const bitmapB = await tileCache.load(b, b.blob);
		await tileCache.load(c, c.blob);
		// Using "a" makes "b" the least recently used.
		tileCache.peek(a);
		await tileCache.load(d, d.blob);
		expect(tileCache.peek(b)).toBeUndefined();
		expect(bitmapB?.closed).toBe(true);
		expect(tileCache.peek(a)).toBe(bitmapA);
		expect(tileCache.bytes).toBe(3 * 400);
	});

	it("never drops tiles on screen; drops them past its budget once they leave it", async () => {
		const { tileCache } = cache(1);
		const [a, b] = ["a", "b"].map(key);
		if (!a || !b) throw new Error("no keys");
		const bitmapA = await tileCache.load(a, a.blob);
		tileCache.pin([a]);
		const bitmapB = await tileCache.load(b, b.blob);
		tileCache.pin([a, b]);
		expect(tileCache.peek(a)).toBe(bitmapA);
		expect(tileCache.peek(b)).toBe(bitmapB);
		expect(tileCache.bytes).toBe(800);
		tileCache.pin([b]);
		expect(bitmapA?.closed).toBe(true);
		expect(tileCache.peek(a)).toBeUndefined();
		expect(tileCache.bytes).toBe(400);
	});

	it("closes the tiles of a plan gone, those still decoding when they arrive", async () => {
		const { tileCache, pause, resume } = cache(4);
		const [a, b] = ["a", "b"].map(key);
		if (!a || !b) throw new Error("no keys");
		const bitmapA = await tileCache.load(a, a.blob);
		pause();
		const loading = tileCache.load(b, b.blob);
		// Let the decoder start.
		await new Promise((resolve) => setTimeout(resolve, 0));
		tileCache.forget([a, b]);
		expect(bitmapA?.closed).toBe(true);
		expect(tileCache.peek(a)).toBeUndefined();
		resume("b");
		expect(await loading).toBeUndefined();
		expect(tileCache.peek(b)).toBeUndefined();
		expect(tileCache.bytes).toBe(0);
	});
});
