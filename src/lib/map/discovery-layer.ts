/**
 * Discovery bubbles on the map (V.2): the centres of indoor spaces from `Discovery`, clustered
 * by MapLibre into bubbles sized and labelled by how many spaces they hold. Drawn below the
 * data zoom only, in the "indoor-top" slot. A click on a bubble zooms to where it splits.
 */
import type { Loc } from "#lib/osm/entity.ts";
import { slotId, slotsReady } from "./layer-slots.ts";
import type {
	ExpressionSpecification,
	GeoJSONSource,
	LayerSpecification,
	Map as MapLibreMap,
} from "./maplibre.ts";
import { indoorColors, type Theme } from "./style/colors.ts";
import { LABEL_FONT } from "./style/layers.ts";

export const DISCOVERY_SOURCE = "discovery";
const BUBBLES = `${DISCOVERY_SOURCE}-bubbles`;
const COUNTS = `${DISCOVERY_SOURCE}-counts`;

/** What a click on the discovery layer found: a cluster, or a single space. */
export interface Bubble {
	readonly loc: Loc;
	/** The cluster's id, or null for a single space. */
	readonly cluster: number | null;
}

/** The bubbles and their counts, shown up to (not at) `maxZoom`. */
export function discoveryLayers(
	maxZoom: number,
	{
		theme = "light",
		textFont = LABEL_FONT,
	}: { theme?: Theme; textFont?: string[] } = {},
): LayerSpecification[] {
	const C = indoorColors(theme);
	const count: ExpressionSpecification = [
		"coalesce",
		["get", "point_count"],
		1,
	];
	return [
		{
			id: BUBBLES,
			type: "circle",
			source: DISCOVERY_SOURCE,
			maxzoom: maxZoom,
			paint: {
				// 8 px for one space, growing with the count's square root to 30 px.
				"circle-radius": ["min", 30, ["+", 6, ["*", 2, ["sqrt", count]]]],
				"circle-color": C.verticalOutline,
				"circle-opacity": 0.85,
				"circle-stroke-color": C.pointStroke,
				"circle-stroke-width": 1.5,
			},
		},
		{
			id: COUNTS,
			type: "symbol",
			source: DISCOVERY_SOURCE,
			maxzoom: maxZoom,
			filter: ["has", "point_count"],
			layout: {
				"text-field": ["get", "point_count_abbreviated"],
				"text-font": textFont,
				"text-size": 12,
				"text-allow-overlap": true,
			},
			paint: { "text-color": "#ffffff" },
		},
	];
}

export class DiscoveryLayer {
	readonly #map: MapLibreMap;
	readonly #maxZoom: number;
	#data: GeoJSON.FeatureCollection = {
		type: "FeatureCollection",
		features: [],
	};
	#theme: Theme = "light";
	#ready = false;
	#removed = false;

	constructor(map: MapLibreMap, maxZoom: number) {
		this.#map = map;
		this.#maxZoom = maxZoom;
		void slotsReady(map).then(() => {
			if (!this.#removed) this.#install();
		});
	}

	setData(data: GeoJSON.FeatureCollection): void {
		this.#data = data;
		if (this.#ready) void this.#source()?.setData(data);
	}

	setTheme(theme: Theme): void {
		this.#theme = theme;
		if (!this.#ready) return;
		for (const layer of discoveryLayers(this.#maxZoom, { theme })) {
			for (const [name, value] of Object.entries(layer.paint ?? {})) {
				this.#map.setPaintProperty(
					layer.id,
					name as Parameters<MapLibreMap["setPaintProperty"]>[1],
					value,
				);
			}
		}
	}

	/** The bubble drawn at a screen point, or null. */
	bubbleAt(point: { x: number; y: number }): Bubble | null {
		if (!this.#ready || this.#map.getZoom() >= this.#maxZoom) return null;
		const [hit] = this.#map.queryRenderedFeatures(
			[
				[point.x - 2, point.y - 2],
				[point.x + 2, point.y + 2],
			],
			{ layers: [BUBBLES] },
		);
		if (hit?.geometry.type !== "Point") return null;
		const [lon = 0, lat = 0] = hit.geometry.coordinates;
		const cluster = hit.properties.cluster_id;
		return {
			loc: [lon, lat],
			cluster: typeof cluster === "number" ? cluster : null,
		};
	}

	/** Zooms to where a bubble splits, or to the data zoom for a single space. */
	async open(bubble: Bubble): Promise<void> {
		const zoom =
			bubble.cluster === null
				? this.#maxZoom + 1
				: Math.min(
						this.#maxZoom + 1,
						(await this.#source()?.getClusterExpansionZoom(bubble.cluster)) ??
							this.#maxZoom,
					);
		this.#map.easeTo({ center: [bubble.loc[0], bubble.loc[1]], zoom });
	}

	remove(): void {
		this.#removed = true;
		if (!this.#ready) return;
		for (const id of [COUNTS, BUBBLES]) {
			if (this.#map.getLayer(id)) this.#map.removeLayer(id);
		}
		if (this.#map.getSource(DISCOVERY_SOURCE)) {
			this.#map.removeSource(DISCOVERY_SOURCE);
		}
		this.#ready = false;
	}

	#install(): void {
		this.#map.addSource(DISCOVERY_SOURCE, {
			type: "geojson",
			data: this.#data,
			cluster: true,
			clusterRadius: 50,
			clusterMaxZoom: this.#maxZoom - 1,
		});
		for (const layer of discoveryLayers(this.#maxZoom, {
			theme: this.#theme,
		})) {
			this.#map.addLayer(layer, slotId("indoor-top"));
		}
		this.#ready = true;
	}

	#source(): GeoJSONSource | undefined {
		return this.#map.getSource<GeoJSONSource>(DISCOVERY_SOURCE);
	}
}
