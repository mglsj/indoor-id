/**
 * Swaps the vector basemap's style (light or dark, with the theme) while keeping everything
 * else on the map. `map.setStyle` would rebuild the style and drop the app's sources, layers
 * (custom WebGL layers too) and images; here only the basemap's own layers and sources are
 * replaced: its labels under the indoor features' top layers, every other layer under the
 * imagery slot, as `installSlots` orders the first basemap.
 */
import { slotId, slotsReady } from "./layer-slots.ts";
import type {
	LayerSpecification,
	Map as MapLibreMap,
	SourceSpecification,
	StyleSpecification,
} from "./maplibre.ts";

interface Basemap {
	url: string;
	layers: string[];
	sources: string[];
}

const basemaps = new WeakMap<MapLibreMap, Basemap>();
/** The latest style asked for each map: a slower earlier swap gives way to it. */
const wanted = new WeakMap<MapLibreMap, string>();
const styles = new Map<string, Promise<StyleSpecification>>();

/**
 * Remembers which layers and sources are the basemap's, each time a whole style loads (the
 * map's first style, or the plain fallback when the basemap failed). Call it when the map is
 * created, before the app adds its own.
 */
export function trackBasemap(map: MapLibreMap, url: string): void {
	map.on("style.load", () => {
		const style = map.getStyle();
		basemaps.set(map, {
			url,
			layers: style.layers.map((layer) => layer.id),
			sources: Object.keys(style.sources),
		});
	});
}

/** Replaces the basemap with the style at `url`, unless it is shown already. */
export async function setBasemap(map: MapLibreMap, url: string): Promise<void> {
	wanted.set(map, url);
	await slotsReady(map);
	if (basemaps.get(map)?.url === url) return;
	const style = await loadStyle(url);
	const current = basemaps.get(map);
	if (wanted.get(map) !== url || !current || !map.style) return;

	for (const id of current.layers) {
		if (map.getLayer(id)) map.removeLayer(id);
	}
	const sources = style.sources as Record<string, SourceSpecification>;
	for (const id of current.sources) {
		const next = sources[id];
		if (!map.getSource(id)) continue;
		if (!next || !sameSource(map, id, next)) map.removeSource(id);
	}
	for (const [id, source] of Object.entries(sources)) {
		if (!map.getSource(id)) map.addSource(id, source);
	}
	if (style.glyphs) map.setGlyphs(style.glyphs);
	if (typeof style.sprite === "string") map.setSprite(style.sprite);

	// As `installSlots` orders a first basemap: labels over the indoor fills, the rest under.
	for (const layer of style.layers as LayerSpecification[]) {
		const label = layer.type === "symbol";
		map.addLayer(layer, slotId(label ? "indoor-top" : "imagery"));
	}
	basemaps.set(map, {
		url,
		layers: style.layers.map((layer) => layer.id),
		sources: Object.keys(sources),
	});
}

function loadStyle(url: string): Promise<StyleSpecification> {
	let style = styles.get(url);
	if (!style) {
		style = fetch(url).then(async (response) => {
			if (!response.ok) {
				throw new Error(`The basemap could not be loaded (${response.status})`);
			}
			return (await response.json()) as StyleSpecification;
		});
		style.catch(() => styles.delete(url));
		styles.set(url, style);
	}
	return style;
}

/** Whether the map's source `id` is the same as `next` (OpenFreeMap's styles share theirs). */
function sameSource(
	map: MapLibreMap,
	id: string,
	next: SourceSpecification,
): boolean {
	const shown = map.getStyle().sources[id];
	return JSON.stringify(shown) === JSON.stringify(next);
}
