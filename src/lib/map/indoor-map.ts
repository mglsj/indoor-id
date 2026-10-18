/**
 * Owns the indoor source and layers on a MapLibre map. Data and level can be set before the
 * basemap style has loaded; they are applied once it is ready.
 */
import { BUILDING_COLOR } from "#lib/floorplans/colors.ts";
import { diffFeatures, type StoredFeatures } from "./feature-store.ts";
import type { IndoorFeature } from "./features.ts";
import { type Slot, slotId, slotsReady } from "./layer-slots.ts";
import type {
	FilterSpecification,
	GeoJSONSource,
	Map as MapLibreMap,
} from "./maplibre.ts";
import { loadIconsOnDemand } from "./style/icons.ts";
import {
	INDOOR_SOURCE,
	indoorLayers,
	SELECTABLE_LAYER_IDS,
} from "./style/layers.ts";

/** The slot of each indoor layer: fills under floor plans, outlines and lines over them,
 * doors, labels and the selection over the basemap's labels. */
const SLOTS: Record<string, Slot> = {
	"indoor-fill": "indoor-fill",
	"indoor-outline": "indoor-lines",
	"indoor-lines": "indoor-lines",
};

/** Outlines of the buildings, drawn only in floor plan mode to place plans against. */
export const BUILDINGS_LAYER = "indoor-buildings";
/** Magenta stands out on plans and imagery; plans' own colours stay clear of it. */
const BUILDING_OUTLINE = BUILDING_COLOR;

/** Click tolerance, in pixels around the pointer. */
const CLICK_TOLERANCE = 4;

export class IndoorMap {
	readonly #map: MapLibreMap;
	#ready = false;
	/** Removed before the style was ready: never installed. */
	#removed = false;
	/** The features last given, and those the source holds (by entity id). */
	#features: StoredFeatures | null = null;
	#sent = new Map<string, IndoorFeature>();
	/** Features were sent since the map last finished drawing. */
	#drawing = false;
	#level = 0;
	#selected: readonly string[] = [];
	#hover: readonly string[] = [];
	#planMode = false;
	#buildingsVisible = true;

	constructor(map: MapLibreMap) {
		this.#map = map;
		loadIconsOnDemand(map);
		void slotsReady(map).then(() => {
			if (!this.#removed) this.#install();
		});
	}

	/**
	 * Shows these features, sending the source only the features that changed since the last
	 * call (`updateData`), or all of them when most changed (new levels encode them all again).
	 */
	setFeatures(features: StoredFeatures): void {
		this.#features = features;
		if (!this.#ready) return;
		const source = this.#source();
		if (!source) return;
		const { add, remove } = diffFeatures(this.#sent, features.byId);
		if (add.length + remove.length === 0) return;
		this.#drawing = true;
		if (add.length + remove.length > features.byId.size / 2) {
			void source.setData(features.collection);
			this.#sent = new Map(features.byId);
			return;
		}
		void source.updateData({ add, remove });
		for (const id of remove) this.#sent.delete(id);
		for (const feature of add)
			this.#sent.set(feature.properties["@id"], feature);
	}

	/** Shows another level: only the layers' filters change, the data stays. */
	setLevel(level: number): void {
		this.#level = level;
		if (!this.#ready) return;
		for (const layer of indoorLayers(level)) {
			if ("filter" in layer && layer.filter) {
				this.#map.setFilter(layer.id, layer.filter as FilterSpecification);
			}
		}
	}

	/**
	 * Floor plan mode: only the buildings' outlines are drawn, as a reference to place plans
	 * against; rooms, icons, labels and the selection are hidden.
	 */
	setPlanMode(on: boolean): void {
		this.#planMode = on;
		if (this.#ready) this.#applyPlanMode();
	}

	/** Whether floor plan mode shows the building outlines. */
	setBuildingsVisible(visible: boolean): void {
		this.#buildingsVisible = visible;
		if (this.#ready) this.#applyPlanMode();
	}

	#applyPlanMode(): void {
		const visibility = (shown: boolean) => (shown ? "visible" : "none");
		for (const layer of indoorLayers(this.#level)) {
			this.#map.setLayoutProperty(
				layer.id,
				"visibility",
				visibility(!this.#planMode),
			);
		}
		this.#map.setLayoutProperty(
			BUILDINGS_LAYER,
			"visibility",
			visibility(this.#planMode && this.#buildingsVisible),
		);
	}

	/** Outlines the selected features, by `@id`. */
	setSelected(ids: readonly string[]): void {
		this.#selected = this.#mark("selected", this.#selected, ids);
	}

	/** Outlines the feature under the pointer faintly, by `@id`, or none. */
	setHover(id: string | null): void {
		this.#hover = this.#mark("hover", this.#hover, id === null ? [] : [id]);
	}

	/** Moves a feature-state flag from the features in `before` to those in `after`. */
	#mark(
		flag: "selected" | "hover",
		before: readonly string[],
		after: readonly string[],
	): readonly string[] {
		if (this.#ready) {
			const kept = new Set(after);
			for (const id of before) {
				if (kept.has(id)) continue;
				this.#map.setFeatureState(
					{ source: INDOOR_SOURCE, id },
					{ [flag]: false },
				);
			}
			for (const id of after) {
				this.#map.setFeatureState(
					{ source: INDOOR_SOURCE, id },
					{ [flag]: true },
				);
			}
		}
		return after;
	}

	/**
	 * Calls `listener` with the number of features drawn, each time the map has finished
	 * drawing what it was last sent (the e2e tests wait on it rather than retrying clicks).
	 * Returns a function removing the listener.
	 */
	onDrawn(listener: (count: number) => void): () => void {
		const onIdle = () => {
			if (!this.#ready || !this.#drawing) return;
			this.#drawing = false;
			listener(this.#sent.size);
		};
		this.#map.on("idle", onIdle);
		return () => this.#map.off("idle", onIdle);
	}

	/** The `@id` of the feature drawn at a screen point, topmost first, or null. */
	hitTest(point: { x: number; y: number }): string | null {
		if (!this.#ready) return null;
		const features = this.#map.queryRenderedFeatures(
			[
				[point.x - CLICK_TOLERANCE, point.y - CLICK_TOLERANCE],
				[point.x + CLICK_TOLERANCE, point.y + CLICK_TOLERANCE],
			],
			{ layers: SELECTABLE_LAYER_IDS },
		);
		const id = features[0]?.properties["@id"];
		return typeof id === "string" ? id : null;
	}

	remove(): void {
		this.#removed = true;
		if (!this.#ready) return;
		for (const { id } of [
			...indoorLayers(this.#level),
			{ id: BUILDINGS_LAYER },
		]) {
			if (this.#map.getLayer(id)) this.#map.removeLayer(id);
		}
		if (this.#map.getSource(INDOOR_SOURCE))
			this.#map.removeSource(INDOOR_SOURCE);
		this.#ready = false;
	}

	#install(): void {
		const map = this.#map;
		map.addSource(INDOOR_SOURCE, {
			type: "geojson",
			data: this.#features?.collection ?? {
				type: "FeatureCollection",
				features: [],
			},
			promoteId: "@id",
		});
		this.#sent = new Map(this.#features?.byId ?? []);
		this.#drawing = true;
		for (const layer of indoorLayers(this.#level)) {
			map.addLayer(layer, slotId(SLOTS[layer.id] ?? "indoor-top"));
		}
		// Placed among the floor plans, in its place in their stack (`FloorPlanLayers`).
		map.addLayer(
			{
				id: BUILDINGS_LAYER,
				type: "line",
				source: INDOOR_SOURCE,
				filter: ["has", "@building"],
				layout: { visibility: "none" },
				paint: { "line-color": BUILDING_OUTLINE, "line-width": 3 },
			},
			slotId("plans"),
		);
		this.#ready = true;
		this.#applyPlanMode();
		this.#mark("selected", [], this.#selected);
		this.#mark("hover", [], this.#hover);
	}

	#source(): GeoJSONSource | undefined {
		return this.#map.getSource<GeoJSONSource>(INDOOR_SOURCE);
	}
}
