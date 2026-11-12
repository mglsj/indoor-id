/**
 * Construction guides on the map (C.5): the shown level's guides, drawn faintly as long dashed
 * lines (each `REACH` metres either side of its origin), above the floor plans and under the
 * indoor outlines ("indoor-lines" slot), like the grid.
 */
import type { FeatureCollection, LineString } from "geojson";
import { guideEnds } from "#lib/edit/precision/construction.ts";
import type { DirectionLine } from "#lib/edit/precision/snap.ts";
import { slotId, slotsReady } from "./layer-slots.ts";
import type { GeoJSONSource, Map as MapLibreMap } from "./maplibre.ts";
import { INDOOR_COLORS as C } from "./style/colors.ts";

const SOURCE = "precision-construction";
const LAYER = `${SOURCE}-lines`;
/** How far each guide is drawn from its origin, in metres: past any building. */
const REACH = 2000;

type GuideData = FeatureCollection<LineString>;

export function constructionFeatures(
	guides: readonly DirectionLine[],
): GuideData {
	return {
		type: "FeatureCollection",
		features: guides.map((guide) => {
			const [from, to] = guideEnds(guide, REACH);
			return {
				type: "Feature",
				properties: {},
				geometry: { type: "LineString", coordinates: [[...from], [...to]] },
			};
		}),
	};
}

export class ConstructionLayer {
	readonly #map: MapLibreMap;
	#data: GuideData = constructionFeatures([]);
	#ready = false;
	#removed = false;

	constructor(map: MapLibreMap) {
		this.#map = map;
		void slotsReady(map).then(() => {
			if (!this.#removed) this.#install();
		});
	}

	setGuides(guides: readonly DirectionLine[]): void {
		this.#data = constructionFeatures(guides);
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
					"line-opacity": 0.6,
					"line-width": 1,
					"line-dasharray": [6, 4],
				},
			},
			slotId("indoor-lines"),
		);
		this.#ready = true;
	}
}
