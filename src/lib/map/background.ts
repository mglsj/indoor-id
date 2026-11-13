/**
 * The raster imagery shown under the indoor data, on top of the vector basemap, moved by its
 * offset (`ImageryLayer`, a custom layer: moving it is a uniform, as iD's CSS transform), or a
 * solid colour in place of the basemap.
 */

import {
	type Imagery,
	type ImageryDisplay,
	type Offset,
	PLAIN_DISPLAY,
} from "./backgrounds.ts";
import { setBasemapShown } from "./basemap.ts";
import { ImageryLayer } from "./imagery-layer.ts";
import { slotId, slotsReady } from "./layer-slots.ts";
import type { Map as MapLibreMap } from "./maplibre.ts";

/** Imagery layers are named with this prefix and a number. */
const PREFIX = "background-imagery";
/** An empty source and layer of each imagery, carrying its attribution to MapLibre's control. */
const ATTRIBUTION = "-attribution";
let lastLayer = 0;

/** The imagery layers on each map, oldest first. */
const layers = new WeakMap<MapLibreMap, ImageryLayer[]>();
const displays = new WeakMap<MapLibreMap, ImageryDisplay>();
/** Maps showing a solid colour in place of the basemap. */
const solid = new WeakSet<MapLibreMap>();

/**
 * Shows the basemap unless a solid colour replaces it, or imagery is drawn behind the canvas
 * (a server without CORS, `ImageryLayer.behind`), where the basemap would cover it.
 */
function updateBasemap(map: MapLibreMap): void {
	const behind = (layers.get(map) ?? []).some((layer) => layer.behind);
	setBasemapShown(map, !solid.has(map) && !behind);
}

/** The layer of the solid colour shown in place of the basemap. */
const SOLID_LAYER = "background-solid";

function removeImagery(map: MapLibreMap, layer: ImageryLayer) {
	layers.set(
		map,
		(layers.get(map) ?? []).filter((shown) => shown !== layer),
	);
	if (map.getLayer(layer.id)) map.removeLayer(layer.id);
	const attribution = layer.id + ATTRIBUTION;
	if (map.getLayer(attribution)) map.removeLayer(attribution);
	if (map.getSource(attribution)) map.removeSource(attribution);
	if (layer.behind) updateBasemap(map);
}

/**
 * Shows imagery moved by `offset`, or only the basemap when `imagery` is null. A new offset for
 * the imagery shown moves it on the next frame; other imagery stays under the new one until
 * its tiles are in, so changing it doesn't flash the basemap.
 */
export async function setBackground(
	map: MapLibreMap,
	imagery: Imagery | null,
	offset: Offset,
): Promise<void> {
	await slotsReady(map);
	const before = layers.get(map) ?? [];
	const last = before.at(-1);
	if (imagery && last?.imagery === imagery) {
		last.setOffset(offset);
		return;
	}
	if (!imagery) {
		for (const layer of before) removeImagery(map, layer);
		return;
	}
	const layer = new ImageryLayer(`${PREFIX}-${++lastLayer}`, imagery, () =>
		updateBasemap(map),
	);
	layer.setOffset(offset);
	layer.setDisplay(displays.get(map) ?? PLAIN_DISPLAY);
	map.addLayer(layer, slotId("imagery"));
	const attribution = imagery.source.attribution;
	if (attribution) {
		const id = layer.id + ATTRIBUTION;
		map.addSource(id, {
			type: "geojson",
			data: { type: "FeatureCollection", features: [] },
			attribution,
		});
		map.addLayer({ id, type: "circle", source: id }, slotId("imagery"));
	}
	layers.set(map, [...before, layer]);
	if (before.length === 0) return;
	await drawn(map, layer);
	for (const old of before) removeImagery(map, old);
}

/** Resolves once the layer draws every tile in view, or after a second at most. */
function drawn(map: MapLibreMap, layer: ImageryLayer): Promise<void> {
	return new Promise((resolve) => {
		const done = () => {
			map.off("render", check);
			clearTimeout(timer);
			resolve();
		};
		const check = () => {
			if (layer.complete) done();
		};
		const timer = setTimeout(done, 1000);
		map.on("render", check);
	});
}

/**
 * Shows a solid colour in place of the basemap (its fills and labels hidden), or the basemap
 * again when `color` is null.
 */
export async function setSolidBackground(
	map: MapLibreMap,
	color: string | null,
): Promise<void> {
	await slotsReady(map);
	if (color === null) solid.delete(map);
	else solid.add(map);
	updateBasemap(map);
	if (color === null) {
		if (map.getLayer(SOLID_LAYER)) map.removeLayer(SOLID_LAYER);
		return;
	}
	if (map.getLayer(SOLID_LAYER)) {
		map.setPaintProperty(SOLID_LAYER, "background-color", color);
		return;
	}
	map.addLayer(
		{
			id: SOLID_LAYER,
			type: "background",
			paint: { "background-color": color },
		},
		slotId("imagery"),
	);
}

/** Changes how the imagery shown is displayed (brightness, contrast, saturation). */
export function setImageryDisplay(
	map: MapLibreMap,
	display: ImageryDisplay,
): void {
	displays.set(map, display);
	for (const layer of layers.get(map) ?? []) layer.setDisplay(display);
}
