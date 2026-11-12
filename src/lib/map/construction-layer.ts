/**
 * Construction guides on the map (C.5): the shown level's guides, drawn faintly as long dashed
 * lines (each `REACH` metres either side of its origin) in their own colour, above the floor
 * plans and under the indoor outlines ("indoor-lines" slot), like the grid. The guide pointed
 * at in the guides pane is drawn solid and wider.
 */
import type { FeatureCollection, LineString } from "geojson";
import type { ConstructionGuide } from "#lib/edit/precision/construction.ts";
import { guideEnds } from "#lib/edit/precision/construction.ts";
import { slotId, slotsReady } from "./layer-slots.ts";
import type { GeoJSONSource, Map as MapLibreMap } from "./maplibre.ts";
import { INDOOR_COLORS as C } from "./style/colors.ts";

const SOURCE = "precision-construction";
const LAYER = `${SOURCE}-lines`;
const HIGHLIGHT = `${SOURCE}-highlight`;
/** How far each guide is drawn from its origin, in metres: past any building. */
const REACH = 2000;

type GuideData = FeatureCollection<LineString>;

/** The guides as lines, each with its colour, and whether it is the one pointed at. */
export function constructionFeatures(
	guides: readonly Pick<
		ConstructionGuide,
		"origin" | "angle" | "id" | "color"
	>[],
	highlight: string | null = null,
): GuideData {
	return {
		type: "FeatureCollection",
		features: guides.map((guide) => {
			const [from, to] = guideEnds(guide, REACH);
			return {
				type: "Feature",
				properties: {
					color: guide.color ?? C.guide,
					highlight: guide.id === highlight,
				},
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

	setGuides(
		guides: readonly ConstructionGuide[],
		highlight: string | null = null,
	): void {
		this.#data = constructionFeatures(guides, highlight);
		if (this.#ready) {
			void this.#map.getSource<GeoJSONSource>(SOURCE)?.setData(this.#data);
		}
	}

	remove(): void {
		this.#removed = true;
		if (!this.#ready) return;
		for (const id of [HIGHLIGHT, LAYER])
			if (this.#map.getLayer(id)) this.#map.removeLayer(id);
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
				filter: ["!", ["get", "highlight"]],
				paint: {
					"line-color": ["get", "color"],
					"line-opacity": 0.7,
					"line-width": 1.25,
					"line-dasharray": [6, 4],
				},
			},
			slotId("indoor-lines"),
		);
		this.#map.addLayer(
			{
				id: HIGHLIGHT,
				type: "line",
				source: SOURCE,
				filter: ["get", "highlight"],
				paint: { "line-color": ["get", "color"], "line-width": 3 },
			},
			slotId("indoor-lines"),
		);
		this.#ready = true;
	}
}
