/**
 * The grid on the map (C.3): its lines from `edit/precision/grid.ts`, faint, the major ones a
 * little stronger, above the floor plans and under the indoor outlines ("indoor-lines" slot).
 */
import type { FeatureCollection, LineString } from "geojson";
import type { GridLine } from "#lib/edit/precision/grid.ts";
import { slotId, slotsReady } from "./layer-slots.ts";
import type { GeoJSONSource, Map as MapLibreMap } from "./maplibre.ts";
import { INDOOR_COLORS as C } from "./style/colors.ts";

const SOURCE = "precision-grid";
const LAYER = `${SOURCE}-lines`;

type GridData = FeatureCollection<LineString, { major: boolean }>;

export function gridFeatures(lines: readonly GridLine[]): GridData {
	return {
		type: "FeatureCollection",
		features: lines.map(({ from, to, major }) => ({
			type: "Feature",
			properties: { major },
			geometry: { type: "LineString", coordinates: [[...from], [...to]] },
		})),
	};
}

export class GridLayer {
	readonly #map: MapLibreMap;
	#data: GridData = gridFeatures([]);
	#ready = false;
	#removed = false;

	constructor(map: MapLibreMap) {
		this.#map = map;
		void slotsReady(map).then(() => {
			if (!this.#removed) this.#install();
		});
	}

	setLines(lines: readonly GridLine[]): void {
		this.#data = gridFeatures(lines);
		if (this.#ready) {
			void this.#map.getSource<GeoJSONSource>(SOURCE)?.setData(this.#data);
		}
	}

	remove(): void {
		this.#removed = true;
		if (!this.#ready) return;
		if (this.#map.getLayer(LAYER)) this.#map.removeLayer(LAYER);
		if (this.#map.getSource(SOURCE)) this.#map.removeSource(SOURCE);
		this.#ready = false;
	}

	#install(): void {
		this.#map.addSource(SOURCE, { type: "geojson", data: this.#data });
		this.#map.addLayer(
			{
				id: LAYER,
				type: "line",
				source: SOURCE,
				paint: {
					"line-color": C.guide,
					"line-opacity": ["case", ["get", "major"], 0.45, 0.18],
					"line-width": ["case", ["get", "major"], 1, 0.75],
				},
			},
			slotId("indoor-lines"),
		);
		this.#ready = true;
	}
}
