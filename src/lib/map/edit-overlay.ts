/**
 * The edit overlay on the map (P5.3.1): vertices, midpoints and untagged member ways from
 * `edit/overlay.ts`, in their own small source above the indoor layers (the "edit" slot), and
 * what a press on them grabs.
 */
import type { FeatureCollection, LineString, Point } from "geojson";
import type { OverlayProperties } from "#lib/edit/overlay.ts";
import type { Loc, NodeId, WayId } from "#lib/osm/entity.ts";
import { slotId, slotsReady } from "./layer-slots.ts";
import type { GeoJSONSource, Map as MapLibreMap } from "./maplibre.ts";
import { INDOOR_COLORS as C } from "./style/colors.ts";

const SOURCE = "edit-overlay";
export const VERTEX_LAYER = `${SOURCE}-vertices`;
export const MIDPOINT_LAYER = `${SOURCE}-midpoints`;
const MEMBER_LAYER = `${SOURCE}-members`;

/** How far from a vertex or midpoint a press still grabs it, in pixels. */
const GRAB_TOLERANCE = 6;

/** What a press on the overlay grabbed. */
export type OverlayGrab =
	| { readonly kind: "vertex"; readonly id: NodeId }
	| {
			readonly kind: "midpoint";
			readonly way: WayId;
			readonly a: NodeId;
			readonly b: NodeId;
			readonly loc: Loc;
	  };

type OverlayData = FeatureCollection<Point | LineString, OverlayProperties>;

export class EditOverlay {
	readonly #map: MapLibreMap;
	#data: OverlayData = { type: "FeatureCollection", features: [] };
	#ready = false;
	/** Removed before the style was ready: never installed. */
	#removed = false;

	constructor(map: MapLibreMap) {
		this.#map = map;
		void slotsReady(map).then(() => {
			if (!this.#removed) this.#install();
		});
	}

	setData(data: OverlayData): void {
		this.#data = data;
		if (this.#ready) {
			void this.#map.getSource<GeoJSONSource>(SOURCE)?.setData(data);
		}
	}

	/** The vertex (first) or midpoint drawn at a screen point, or null. */
	grabAt(point: { x: number; y: number }): OverlayGrab | null {
		if (!this.#ready) return null;
		const d = GRAB_TOLERANCE;
		const box: [[number, number], [number, number]] = [
			[point.x - d, point.y - d],
			[point.x + d, point.y + d],
		];
		const nearestOf = (layer: string) => {
			let best: { properties: OverlayProperties; loc: Loc } | null = null;
			let bestDistance = Number.POSITIVE_INFINITY;
			for (const f of this.#map.queryRenderedFeatures(box, {
				layers: [layer],
			})) {
				if (f.geometry.type !== "Point") continue;
				const [lon = 0, lat = 0] = f.geometry.coordinates;
				const at = this.#map.project([lon, lat]);
				const distance = Math.hypot(at.x - point.x, at.y - point.y);
				if (distance < bestDistance) {
					bestDistance = distance;
					best = {
						properties: f.properties as OverlayProperties,
						loc: [lon, lat],
					};
				}
			}
			return best;
		};
		const vertex = nearestOf(VERTEX_LAYER);
		if (vertex?.properties["@role"] === "vertex") {
			return { kind: "vertex", id: vertex.properties["@id"] };
		}
		const mid = nearestOf(MIDPOINT_LAYER);
		if (mid?.properties["@role"] === "midpoint") {
			const p = mid.properties;
			return {
				kind: "midpoint",
				way: p["@way"],
				a: p["@a"],
				b: p["@b"],
				loc: mid.loc,
			};
		}
		return null;
	}

	remove(): void {
		this.#removed = true;
		if (!this.#ready) return;
		for (const id of [VERTEX_LAYER, MIDPOINT_LAYER, MEMBER_LAYER]) {
			if (this.#map.getLayer(id)) this.#map.removeLayer(id);
		}
		if (this.#map.getSource(SOURCE)) this.#map.removeSource(SOURCE);
		this.#ready = false;
	}

	#install(): void {
		const map = this.#map;
		map.addSource(SOURCE, { type: "geojson", data: this.#data });
		const edit = slotId("edit");
		const role = (r: OverlayProperties["@role"]) =>
			["==", ["get", "@role"], r] as ["==", ["get", string], string];
		map.addLayer(
			{
				id: MEMBER_LAYER,
				type: "line",
				source: SOURCE,
				filter: role("member"),
				paint: {
					"line-color": C.selection,
					"line-width": 1.5,
					"line-dasharray": [3, 2],
				},
			},
			edit,
		);
		map.addLayer(
			{
				id: MIDPOINT_LAYER,
				type: "circle",
				source: SOURCE,
				filter: role("midpoint"),
				paint: {
					"circle-radius": 3,
					"circle-color": C.selection,
					"circle-opacity": 0.85,
					"circle-stroke-color": C.pointStroke,
					"circle-stroke-width": 1,
				},
			},
			edit,
		);
		map.addLayer(
			{
				id: VERTEX_LAYER,
				type: "circle",
				source: SOURCE,
				filter: role("vertex"),
				paint: {
					// Junctions a little larger: moving one moves several ways.
					"circle-radius": ["case", ["has", "@shared"], 4.5, 4],
					"circle-color": C.pointStroke,
					"circle-stroke-color": ["case", ["has", "@shared"], C.text, C.point],
					"circle-stroke-width": ["case", ["has", "@shared"], 2, 1.5],
				},
			},
			edit,
		);
		this.#ready = true;
	}
}
