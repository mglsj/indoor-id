/**
 * When a map's style can take sources and layers. MapLibre's `isStyleLoaded()` is false again
 * whenever a tile or an image is loading, and `load` fires only once, so a layer owner made
 * after the first load (mid-pan) and waiting for `load` would wait forever. The first call for
 * a map, made when it is created (`MapView`), remembers its first load for every later one.
 */
import type { Map as MapLibreMap } from "./maplibre.ts";

const ready = new WeakMap<MapLibreMap, Promise<void>>();

export function styleReady(map: MapLibreMap): Promise<void> {
	let promise = ready.get(map);
	if (!promise) {
		promise = map.isStyleLoaded()
			? Promise.resolve()
			: new Promise((resolve) => map.once("load", () => resolve()));
		ready.set(map, promise);
	}
	return promise;
}
