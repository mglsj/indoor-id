/**
 * Snap guides on the map (C.0, C.1): the dashed lines that explain a snap (an angle's ray, the
 * line that crossed a side) and a marker on the snapped point whose look says its kind: a
 * ring on a node, a dot on a side, a diamond-like square for a midpoint or a crossing, a
 * hollow dot on an angle ray. In the "edit" slot, above the edit overlay's vertices.
 */
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { Feedback } from "#lib/edit/precision/feedback.ts";
import type { SnapTarget } from "#lib/edit/precision/snap.ts";
import { slotId, slotsReady } from "./layer-slots.ts";
import type {
	ExpressionSpecification,
	GeoJSONSource,
	Map as MapLibreMap,
} from "./maplibre.ts";
import { INDOOR_COLORS as C } from "./style/colors.ts";

const SOURCE = "precision-guides";
const LINE_LAYER = `${SOURCE}-lines`;
const MARK_LAYER = `${SOURCE}-marks`;

/** The kind of mark drawn on a snapped point. */
export type MarkKind =
	| "node"
	| "segment"
	| "midpoint"
	| "intersection"
	| "plan"
	| "grid"
	| "angle"
	| "lock"
	| "perpendicular"
	| "armed"
	| "guide";

interface GuideProperties {
	readonly role: "guide" | "mark";
	readonly mark?: MarkKind;
}

type GuideData = FeatureCollection<LineString | Point, GuideProperties>;

/** The mark a snap is shown with. */
export function markOf(target: SnapTarget): MarkKind {
	return target.kind === "segment" ? (target.mark ?? "segment") : target.kind;
}

/** What the guide layer draws for some feedback. */
export function guideFeatures(feedback: Feedback | null): GuideData {
	const features: Feature<LineString | Point, GuideProperties>[] = [];
	for (const { from, to } of feedback?.lines ?? []) {
		features.push({
			type: "Feature",
			properties: { role: "guide" },
			geometry: { type: "LineString", coordinates: [[...from], [...to]] },
		});
	}
	const snap = feedback?.snap;
	if (snap) {
		const guides = "guides" in snap ? (snap.guides ?? []) : [];
		for (const { from, to } of guides) {
			features.push({
				type: "Feature",
				properties: { role: "guide" },
				geometry: { type: "LineString", coordinates: [[...from], [...to]] },
			});
		}
		features.push({
			type: "Feature",
			properties: { role: "mark", mark: markOf(snap) },
			geometry: { type: "Point", coordinates: [...snap.loc] },
		});
	}
	// Corners armed for tracking (C.4): a small hollow mark each.
	for (const loc of feedback?.armed ?? []) {
		features.push({
			type: "Feature",
			properties: { role: "mark", mark: "armed" },
			geometry: { type: "Point", coordinates: [...loc] },
		});
	}
	return { type: "FeatureCollection", features };
}

export class GuideLayer {
	readonly #map: MapLibreMap;
	#data: GuideData = guideFeatures(null);
	#ready = false;
	#removed = false;

	constructor(map: MapLibreMap) {
		this.#map = map;
		void slotsReady(map).then(() => {
			if (!this.#removed) this.#install();
		});
	}

	show(feedback: Feedback | null): void {
		this.#data = guideFeatures(feedback);
		if (this.#ready) {
			void this.#map.getSource<GeoJSONSource>(SOURCE)?.setData(this.#data);
		}
	}

	remove(): void {
		this.#removed = true;
		if (!this.#ready) return;
		for (const id of [LINE_LAYER, MARK_LAYER]) {
			if (this.#map.getLayer(id)) this.#map.removeLayer(id);
		}
		if (this.#map.getSource(SOURCE)) this.#map.removeSource(SOURCE);
		this.#ready = false;
	}

	#install(): void {
		const map = this.#map;
		map.addSource(SOURCE, { type: "geojson", data: this.#data });
		const edit = slotId("edit");
		map.addLayer(
			{
				id: LINE_LAYER,
				type: "line",
				source: SOURCE,
				filter: ["==", ["get", "role"], "guide"],
				paint: {
					"line-color": C.guide,
					"line-width": 1.5,
					"line-dasharray": [4, 3],
				},
			},
			edit,
		);
		const mark = (kinds: MarkKind[]): ExpressionSpecification => [
			"in",
			["get", "mark"],
			["literal", kinds],
		];
		map.addLayer(
			{
				id: MARK_LAYER,
				type: "circle",
				source: SOURCE,
				filter: ["==", ["get", "role"], "mark"],
				paint: {
					"circle-radius": [
						"case",
						mark(["node", "intersection"]),
						7,
						mark(["midpoint", "plan", "grid", "perpendicular", "guide"]),
						5,
						mark(["armed"]),
						3,
						4,
					],
					// Hollow on a free spot (an angle ray, a locked direction), filled on geometry.
					"circle-color": [
						"case",
						mark(["angle", "lock", "node", "armed"]),
						"rgba(0, 0, 0, 0)",
						C.guide,
					],
					"circle-stroke-color": C.guide,
					"circle-stroke-width": 2,
				},
			},
			edit,
		);
		this.#ready = true;
	}
}
