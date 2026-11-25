/**
 * The grid on the map (C.3): its lines from `edit/precision/grid.ts`, the major ones stronger,
 * above the floor plans and under the indoor outlines ("indoor-lines" slot), in the colour and
 * opacities of the Map data pane (A.4).
 */
import type { FeatureCollection, LineString } from "geojson";
import type { GridLine } from "#lib/edit/precision/grid.ts";
import { slotId, slotsReady } from "./layer-slots.ts";
import type {
	ExpressionSpecification,
	GeoJSONSource,
	Map as MapLibreMap,
} from "./maplibre.ts";

const SOURCE = "precision-grid";
const LAYER = `${SOURCE}-lines`;

type GridData = FeatureCollection<LineString, { major: boolean }>;

/** How the grid is drawn: a colour (`#rrggbb`) and the minor and major lines' opacities. */
export interface GridStyle {
	readonly color: string;
	readonly minorOpacity: number;
	readonly majorOpacity: number;
}

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
	#style: GridStyle;
	#ready = false;
	#removed = false;

	constructor(map: MapLibreMap, style: GridStyle) {
		this.#map = map;
		this.#style = style;
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

	setStyle(style: GridStyle): void {
		this.#style = style;
		if (!this.#ready) return;
		for (const [name, value] of Object.entries(this.#paint())) {
			this.#map.setPaintProperty(
				LAYER,
				name as Parameters<MapLibreMap["setPaintProperty"]>[1],
				value,
			);
		}
	}

	#paint() {
		const { color, minorOpacity, majorOpacity } = this.#style;
		return {
			"line-color": color,
			"line-opacity": [
				"case",
				["get", "major"],
				majorOpacity,
				minorOpacity,
			] as ExpressionSpecification,
			"line-width": [
				"case",
				["get", "major"],
				1,
				0.75,
			] as ExpressionSpecification,
		};
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
				paint: this.#paint(),
			},
			slotId("indoor-lines"),
		);
		this.#ready = true;
	}
}
