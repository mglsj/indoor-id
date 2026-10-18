import { describe, expect, it } from "vitest";
import type { Map as MapLibreMap } from "./maplibre.ts";
import { styleReady } from "./ready.ts";

/** A map stand-in: `load` fires once; `isStyleLoaded` is false again while tiles load. */
function fakeMap(loaded = false) {
	const listeners: (() => void)[] = [];
	let styleLoaded = loaded;
	const map = {
		isStyleLoaded: () => styleLoaded,
		once: (type: string, listener: () => void) => {
			if (type === "load") listeners.push(listener);
			return map;
		},
	};
	return {
		map: map as unknown as MapLibreMap,
		load() {
			styleLoaded = true;
			for (const listener of listeners.splice(0)) listener();
		},
		loadTiles() {
			styleLoaded = false;
		},
	};
}

const settled = async (promise: Promise<void>) => {
	let done = false;
	void promise.then(() => (done = true));
	await new Promise((resolve) => setTimeout(resolve));
	return done;
};

describe("styleReady", () => {
	it("waits for the map's first load", async () => {
		const fake = fakeMap();
		const ready = styleReady(fake.map);
		expect(await settled(ready)).toBe(false);
		fake.load();
		expect(await settled(ready)).toBe(true);
	});

	it("stays ready once loaded, even while tiles load later (MapLibre's isStyleLoaded)", async () => {
		const fake = fakeMap();
		styleReady(fake.map);
		fake.load();
		fake.loadTiles();
		// A layer owner made now, mid-pan: `load` won't fire again.
		expect(await settled(styleReady(fake.map))).toBe(true);
	});

	it("is ready at once for a map already loaded", async () => {
		expect(await settled(styleReady(fakeMap(true).map))).toBe(true);
	});
});
