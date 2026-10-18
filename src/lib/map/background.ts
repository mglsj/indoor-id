/** The raster imagery shown under the indoor data, on top of the vector basemap. */
import type { ImageryEntry } from "./imagery.ts";
import { slotId, slotsReady } from "./layer-slots.ts";
import type { Map as MapLibreMap } from "./maplibre.ts";

const SOURCE = "background-imagery";
const LAYER = "background-imagery";

/** Shows an imagery source, or only the basemap when `entry` is null. */
export async function setBackground(
	map: MapLibreMap,
	entry: ImageryEntry | null,
): Promise<void> {
	await slotsReady(map);
	if (map.getLayer(LAYER)) map.removeLayer(LAYER);
	if (map.getSource(SOURCE)) map.removeSource(SOURCE);
	if (!entry) return;
	map.addSource(SOURCE, entry.source);
	map.addLayer(
		{ id: LAYER, type: "raster", source: SOURCE },
		slotId("imagery"),
	);
}
