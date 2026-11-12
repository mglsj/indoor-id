/**
 * Owns the indoor source and layers on a MapLibre map. Data and level can be set before the
 * basemap style has loaded; they are applied once it is ready.
 */
import { BUILDING_COLOR } from "#lib/floorplans/colors.ts";
import { type AreaGeometry, BandStore, bandZoom } from "./area-bands.ts";
import { diffFeatures, type StoredFeatures } from "./feature-store.ts";
import type { IndoorFeature } from "./features.ts";
import { type Slot, slotId, slotsReady } from "./layer-slots.ts";
import type {
	FilterSpecification,
	GeoJSONSource,
	MapGeoJSONFeature,
	Map as MapLibreMap,
} from "./maplibre.ts";
import type { AreaFill, Theme } from "./style/colors.ts";
import { loadIconsOnDemand } from "./style/icons.ts";
import {
	BAND_SOURCE,
	EDITED_LINE_LAYER,
	type EditKind,
	FILL_BAND_LAYER,
	INDOOR_SOURCE,
	indoorLayers,
	type Presentation,
	selectableLayers,
} from "./style/layers.ts";

/**
 * How the indoor layers look: for editing or viewing, on a light or dark map, with areas filled
 * partly (iD's default), whole or not at all while editing.
 */
export interface IndoorLook {
	readonly presentation: Presentation;
	readonly theme: Theme;
	readonly fill?: AreaFill;
}

/** The labels' layer: an area's label doesn't pick the area unless areas are filled whole. */
const LABELS_LAYER = "indoor-labels";
/** How far around the pointer labels are hidden, in pixels. */
const LABEL_CLEARANCE = 30;

/** The slot of each indoor layer: fills under floor plans, outlines and lines over them,
 * doors, labels and the selection over the basemap's labels. */
const SLOTS: Record<string, Slot> = {
	"indoor-fill": "indoor-fill",
	[FILL_BAND_LAYER]: "indoor-fill",
	"indoor-outline": "indoor-lines",
	[EDITED_LINE_LAYER]: "indoor-lines",
	"indoor-lines": "indoor-lines",
	"indoor-rails-left": "indoor-lines",
	"indoor-rails-right": "indoor-lines",
};

/** Outlines of the buildings, drawn only in floor plan mode to place plans against. */
export const BUILDINGS_LAYER = "indoor-buildings";
/** Magenta stands out on plans and imagery; plans' own colours stay clear of it. */
const BUILDING_OUTLINE = BUILDING_COLOR;

/** Click tolerance, in pixels around the pointer. */
const CLICK_TOLERANCE = 4;
/** The areas' outlines, which a click picks before the floor inside them (P5.4a). */
const OUTLINE_LAYER = "indoor-outline";

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
	#look: IndoorLook = { presentation: "edit", theme: "light" };
	/** How features were edited, as the feature state `edited`. */
	#edited: ReadonlyMap<string, EditKind> = new Map();
	/** Labels hidden near the pointer. */
	#nearPointer = new Set<string>();
	/** Rooms' uses (V.3), as the feature state `use`. */
	#uses: ReadonlyMap<string, string> = new Map();

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
		this.#send(source, features);
		this.#updateBands();
	}

	#send(source: GeoJSONSource, features: StoredFeatures): void {
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

	/** Built bands of the areas in view (iD's partial fill). */
	readonly #bands = new BandStore();
	#bandsShown = false;

	/**
	 * Builds the partial fill's bands for the areas in view and half as much around, at the
	 * map's zoom in half steps, when the editor fills areas partly; else clears them.
	 */
	#updateBands = (): void => {
		if (!this.#ready) return;
		const source = this.#map.getSource<GeoJSONSource>(BAND_SOURCE);
		if (!source) return;
		const partial =
			this.#look.presentation === "edit" &&
			(this.#look.fill ?? "partial") === "partial";
		if (!partial || !this.#features) {
			if (this.#bandsShown) {
				this.#bands.update([], { west: 0, south: 0, east: 0, north: 0 }, 0);
				void source.setData({ type: "FeatureCollection", features: [] });
				this.#bandsShown = false;
			}
			return;
		}
		const bounds = this.#map.getBounds();
		const dx = (bounds.getEast() - bounds.getWest()) / 2;
		const dy = (bounds.getNorth() - bounds.getSouth()) / 2;
		const view = {
			west: bounds.getWest() - dx,
			south: bounds.getSouth() - dy,
			east: bounds.getEast() + dx,
			north: bounds.getNorth() + dy,
		};
		const areas = [];
		for (const feature of this.#features.byId.values()) {
			const type = feature.geometry.type;
			if (type !== "Polygon" && type !== "MultiPolygon") continue;
			areas.push({
				id: feature.properties["@id"],
				geometry: feature.geometry as AreaGeometry,
				properties: feature.properties,
			});
		}
		const { features, changed } = this.#bands.update(
			areas,
			view,
			bandZoom(this.#map.getZoom()),
		);
		if (changed || !this.#bandsShown) {
			void source.setData({ type: "FeatureCollection", features });
			this.#bandsShown = true;
		}
	};

	/** Shows another level: only the layers' filters change, the data stays. */
	setLevel(level: number): void {
		this.#level = level;
		if (!this.#ready) return;
		for (const layer of indoorLayers(level, this.#look)) {
			if ("filter" in layer && layer.filter) {
				this.#map.setFilter(layer.id, layer.filter as FilterSpecification);
			}
		}
	}

	/** Draws the indoor data for editing or viewing, on a light or dark map: only paint changes. */
	setLook(look: IndoorLook): void {
		if (
			look.presentation === this.#look.presentation &&
			look.theme === this.#look.theme &&
			look.fill === this.#look.fill
		) {
			return;
		}
		this.#look = look;
		if (!this.#ready) return;
		for (const layer of indoorLayers(this.#level, look)) {
			for (const [name, value] of Object.entries(layer.paint ?? {})) {
				this.#map.setPaintProperty(
					layer.id,
					name as Parameters<MapLibreMap["setPaintProperty"]>[1],
					value,
				);
			}
		}
		this.#updateBands();
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
		for (const layer of indoorLayers(this.#level, this.#look)) {
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

	/** Colours rooms by use in the viewer: `use` by feature id (`view/room-use.ts`). */
	setUses(uses: ReadonlyMap<string, string>): void {
		const before = this.#uses;
		this.#uses = uses;
		if (!this.#ready) return;
		for (const id of before.keys()) {
			if (!uses.has(id)) {
				this.#map.setFeatureState({ source: INDOOR_SOURCE, id }, { use: null });
			}
		}
		for (const [id, use] of uses) {
			if (before.get(id) !== use) {
				this.#map.setFeatureState({ source: INDOOR_SOURCE, id }, { use });
			}
		}
	}

	/** Highlights edited features (iD's "Highlight changes"): how each was edited, by `@id`. */
	setEdited(edited: ReadonlyMap<string, EditKind>): void {
		const before = this.#edited;
		this.#edited = edited;
		if (!this.#ready) return;
		this.#applyEdited(before, edited);
	}

	#applyEdited(
		before: ReadonlyMap<string, EditKind>,
		after: ReadonlyMap<string, EditKind>,
	): void {
		for (const id of before.keys()) {
			if (!after.has(id)) {
				this.#map.setFeatureState(
					{ source: INDOOR_SOURCE, id },
					{ edited: null },
				);
			}
		}
		for (const [id, kind] of after) {
			if (before.get(id) !== kind) {
				this.#map.setFeatureState(
					{ source: INDOOR_SOURCE, id },
					{ edited: kind },
				);
			}
		}
	}

	/**
	 * Hides the labels around the pointer (iD), to see what they cover; null shows them all.
	 * Labels within `LABEL_CLEARANCE` pixels of it are hidden.
	 */
	hideLabelsNear(point: { x: number; y: number } | null): void {
		if (!this.#ready) return;
		const near = new Set<string>();
		if (point) {
			for (const f of this.#map.queryRenderedFeatures(
				[
					[point.x - LABEL_CLEARANCE, point.y - LABEL_CLEARANCE],
					[point.x + LABEL_CLEARANCE, point.y + LABEL_CLEARANCE],
				],
				{ layers: [LABELS_LAYER] },
			)) {
				const id = f.properties["@id"];
				if (typeof id === "string") near.add(id);
			}
		}
		for (const id of this.#nearPointer) {
			if (!near.has(id))
				this.#map.setFeatureState(
					{ source: INDOOR_SOURCE, id },
					{ nearPointer: false },
				);
		}
		for (const id of near) {
			if (!this.#nearPointer.has(id))
				this.#map.setFeatureState(
					{ source: INDOOR_SOURCE, id },
					{ nearPointer: true },
				);
		}
		this.#nearPointer = near;
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

	/**
	 * The `@id` of the feature drawn at a screen point, topmost first, or null. Unless areas
	 * are filled whole, an area is found by its band or outline only (iD), not by a point
	 * inside it or its label: working inside a large area doesn't select it.
	 */
	hitTest(point: { x: number; y: number }): string | null {
		const fill = this.#fill();
		return this.#hit(
			point,
			selectableLayers(fill),
			fill === "full"
				? undefined
				: (feature) =>
						feature.layer.id !== LABELS_LAYER ||
						feature.geometry.type === "Point",
		);
	}

	/** The fill clicks follow: the viewer's areas are filled whole. */
	#fill(): AreaFill {
		return this.#look.presentation === "view"
			? "full"
			: (this.#look.fill ?? "partial");
	}

	/** The `@id` of the area whose outline is drawn at a screen point, or null. */
	outlineAt(point: { x: number; y: number }): string | null {
		return this.#hit(point, [OUTLINE_LAYER]);
	}

	#hit(
		point: { x: number; y: number },
		layers: string[],
		keep?: (feature: MapGeoJSONFeature) => boolean,
	): string | null {
		if (!this.#ready) return null;
		const features = this.#map.queryRenderedFeatures(
			[
				[point.x - CLICK_TOLERANCE, point.y - CLICK_TOLERANCE],
				[point.x + CLICK_TOLERANCE, point.y + CLICK_TOLERANCE],
			],
			{ layers },
		);
		const hit = keep ? features.find(keep) : features[0];
		const id = hit?.properties["@id"];
		return typeof id === "string" ? id : null;
	}

	remove(): void {
		this.#removed = true;
		if (!this.#ready) return;
		for (const { id } of [
			...indoorLayers(this.#level, this.#look),
			{ id: BUILDINGS_LAYER },
		]) {
			if (this.#map.getLayer(id)) this.#map.removeLayer(id);
		}
		this.#map.off("moveend", this.#updateBands);
		for (const source of [INDOOR_SOURCE, BAND_SOURCE]) {
			if (this.#map.getSource(source)) this.#map.removeSource(source);
		}
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
			// The indoor features are OSM data, under the ODbL: credit it whatever the basemap.
			attribution:
				'<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>',
		});
		map.addSource(BAND_SOURCE, {
			type: "geojson",
			data: { type: "FeatureCollection", features: [] },
			promoteId: "@id",
		});
		this.#sent = new Map(this.#features?.byId ?? []);
		this.#drawing = true;
		for (const layer of indoorLayers(this.#level, this.#look)) {
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
		map.on("moveend", this.#updateBands);
		this.#updateBands();
		for (const [id, use] of this.#uses) {
			map.setFeatureState({ source: INDOOR_SOURCE, id }, { use });
		}
		this.#applyEdited(new Map(), this.#edited);
		this.#mark("selected", [], this.#selected);
		this.#mark("hover", [], this.#hover);
	}

	#source(): GeoJSONSource | undefined {
		return this.#map.getSource<GeoJSONSource>(INDOOR_SOURCE);
	}
}
