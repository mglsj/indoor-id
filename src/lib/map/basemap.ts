/**
 * The vector basemap (OpenFreeMap's light style, always: a dark map is harder to read): which
 * of the map's layers are its own, to hide them when a solid colour is shown instead.
 */
import type { Map as MapLibreMap } from "./maplibre.ts";

/** The basemap's layers on each map. */
const basemaps = new WeakMap<MapLibreMap, string[]>();

/**
 * Remembers which layers are the basemap's, each time a whole style loads (the
 * map's first style, or the plain fallback when the basemap failed). Call it when the map is
 * created, before the app adds its own.
 */
export function trackBasemap(map: MapLibreMap): void {
	map.on("style.load", () => {
		basemaps.set(
			map,
			map.getStyle().layers.map((layer) => layer.id),
		);
	});
}

/** The basemap layers hidden by `setBasemapShown`, to show them again. */
const hidden = new WeakMap<MapLibreMap, string[]>();

/**
 * Hides the basemap's layers (a solid colour is shown instead) or shows them again. Layers the
 * style itself hides stay hidden.
 */
export function setBasemapShown(map: MapLibreMap, shown: boolean): void {
	if (shown) {
		for (const id of hidden.get(map) ?? []) {
			if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
		}
		hidden.delete(map);
		return;
	}
	if (hidden.has(map)) return;
	const ids = (basemaps.get(map) ?? []).filter(
		(id) =>
			map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none",
	);
	for (const id of ids) map.setLayoutProperty(id, "visibility", "none");
	hidden.set(map, ids);
}
