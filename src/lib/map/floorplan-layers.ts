/**
 * Draws floor plans on the map: one MapLibre image source and raster layer per plan tile on
 * screen, or one custom WebGL layer for a vector plan (`vector-plan-layer.ts`), above the
 * indoor fills (which would hide them) and below the indoor outlines, icons and labels; a
 * vector plan's text as a symbol layer right above it (`plan-labels.ts`). Plans are compared by
 * identity, so only what changed is updated: moving a plan sets new coordinates or a new
 * matrix, it never re-uploads the image or the paths.
 *
 * A raster plan draws the tiles of its pyramid level that the view covers, updated as the map
 * moves. Stored tiles are decoded when first shown (`TileCache`); until they are, the nearest
 * coarser level already decoded there is drawn under them.
 */
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type {
	PlanContent,
	PlanTile,
	RasterContent,
} from "#lib/floorplans/content.ts";
import {
	corners,
	groundDistance,
	type LngLat,
	type Pixel,
	project,
} from "#lib/floorplans/georef.ts";
import type { TileCache } from "#lib/floorplans/tile-cache.ts";
import {
	type Bounds,
	pyramidLevel,
	tileCorners,
	visibleTiles,
} from "#lib/floorplans/tiling.ts";
import type { VectorContent } from "#lib/floorplans/vector.ts";
import { EARTH_RADIUS } from "#lib/osm/geometry.ts";
import {
	type FloorPlan,
	isPlanOnLevel,
	type LayerEntry,
	type Tool,
} from "#lib/state/floorplans.svelte.ts";
import { BUILDINGS_LAYER } from "./indoor-map.ts";
import { slotId, slotsReady } from "./layer-slots.ts";
import type {
	ExpressionSpecification,
	GeoJSONSource,
	ImageSource,
	Map as MapLibreMap,
} from "./maplibre.ts";
import { labelOpacity, planLabelLayer, planLabels } from "./plan-labels.ts";
import { VectorPlanLayer } from "./vector-plan-layer.ts";

/** Prefix of the floor plan source and layer ids. */
export const FLOORPLAN_PREFIX = "floorplan-";

interface Shown {
	readonly plan: FloorPlan;
	/** The content drawn: its raster's tiles on screen, or its paths. */
	readonly raster?: RasterContent;
	readonly vector?: {
		readonly content: VectorContent;
		readonly layer: VectorPlanLayer;
	};
	/** Its map layers, bottom first. */
	readonly ids: readonly string[];
	/** Index of the pyramid level drawn sharp. */
	readonly level: number;
	/** A raster plan's tile drawn by each layer (named as its source). */
	readonly tiles?: ReadonlyMap<string, PlanTile>;
}

/** How far past the view's edges tiles are drawn, in views: panning a little shows no gap. */
const VIEW_MARGIN = 0.25;

export class FloorPlanLayers {
	readonly #map: MapLibreMap;
	#ready = false;
	/** Removed before the style was ready: never installed. */
	#removed = false;
	#layers: readonly LayerEntry[] = [];
	#plans: readonly FloorPlan[] = [];
	#contents: ReadonlyMap<string, PlanContent> = new Map();
	#level = 0;
	readonly #shown = new Map<string, Shown>();
	/** The map layers in stack order last time, to reorder only when it changes. */
	#order = "";
	readonly #tiles: TileCache | undefined;
	/** A sync waiting for the next frame. */
	#frame = 0;
	readonly #tileListeners = new Set<(count: number) => void>();

	/** `tiles` decodes stored tiles; without it, only tiles already decoded are drawn. */
	constructor(map: MapLibreMap, tiles?: TileCache) {
		this.#map = map;
		this.#tiles = tiles;
		const install = () => {
			this.#ready = true;
			this.#sync();
			// Moving brings other tiles on screen; zooming, another level of the pyramids.
			map.on("move", this.#schedule);
		};
		void slotsReady(map).then(() => {
			if (!this.#removed) install();
		});
	}

	/** Shows the plans of this stack, bottom first, the building outlines in their place. */
	setLayers(layers: readonly LayerEntry[]): void {
		this.#layers = layers;
		this.#plans = layers.flatMap((l) => (l.kind === "plan" ? [l.plan] : []));
		if (this.#ready) this.#sync();
	}

	/** The plans' content, by id: a plan without any yet isn't drawn. */
	setContents(contents: ReadonlyMap<string, PlanContent>): void {
		this.#contents = contents;
		if (this.#ready) this.#sync();
	}

	/** Shows only the plans of this level, and those not assigned to any. */
	setLevel(level: number): void {
		this.#level = level;
		if (this.#ready) this.#sync();
	}

	/** Calls `listener` with how many raster tiles are drawn, each time it changes. */
	onTiles(listener: (count: number) => void): () => void {
		this.#tileListeners.add(listener);
		return () => this.#tileListeners.delete(listener);
	}

	remove(): void {
		this.#removed = true;
		this.#map.off("move", this.#schedule);
		cancelAnimationFrame(this.#frame);
		for (const id of [...this.#shown.keys()]) this.#hide(id);
		this.#tiles?.pin([]);
	}

	/** Syncs once on the next frame, however many times the map moved meanwhile. */
	readonly #schedule = () => {
		if (this.#frame || this.#removed) return;
		this.#frame = requestAnimationFrame(() => {
			this.#frame = 0;
			if (!this.#removed) this.#sync();
		});
	};

	#sync(): void {
		const wanted = this.#plans.filter((p) => {
			const content = this.#contents.get(p.id);
			return (
				p.visible &&
				isPlanOnLevel(p, this.#level) &&
				(content?.vector || content?.raster)
			);
		});
		const wantedIds = new Set(wanted.map((p) => p.id));
		for (const [id, shown] of this.#shown) {
			const content = this.#contents.get(id);
			const changed = shown.vector
				? shown.vector.content !== content?.vector
				: shown.raster !== content?.raster || Boolean(content?.vector);
			if (changed || !wantedIds.has(id)) this.#hide(id);
		}
		const bounds = this.#bounds();
		let added = false;
		for (const plan of wanted) {
			const shown = this.#shown.get(plan.id);
			const content = this.#contents.get(plan.id);
			if (content?.vector) {
				if (!shown) {
					this.#showVector(plan, content.vector);
					added = true;
				} else if (shown.plan !== plan) this.#update(shown, plan);
			} else if (content?.raster) {
				this.#showRaster(plan, content.raster, bounds);
			}
		}
		// The stored tiles drawn stay decoded.
		this.#tiles?.pin(
			[...this.#shown.values()].flatMap((shown) => [
				...(shown.tiles?.values() ?? []),
			]),
		);
		const order = stackLayerIds(
			this.#layers,
			(id) => this.#shown.get(id)?.ids ?? [],
			BUILDINGS_LAYER,
		).filter((id) => this.#map.getLayer(id));
		const key = order.join(",");
		if (!added && key === this.#order) return;
		if (this.#tileListeners.size > 0) {
			const count = [...this.#shown.values()].reduce(
				(sum, shown) => sum + (shown.tiles?.size ?? 0),
				0,
			);
			for (const listener of this.#tileListeners) listener(count);
		}
		this.#order = key;
		// Each one moved to the top of the plans' slot in turn: the last ends up on top.
		const below = this.#below();
		for (const id of order) this.#map.moveLayer(id, below);
	}

	/**
	 * The pyramid level to draw: the smallest one still having at least one pixel per screen
	 * pixel, so the GPU never shrinks a level by much more than half (`pyramidLevel` keeps the
	 * one drawn a little past its range while zooming).
	 */
	#pyramidLevel(plan: FloorPlan, raster: RasterContent): number {
		const { width, height } = plan.size;
		const centre: Pixel = [width / 2, height / 2];
		const step = Math.min(100, width / 2);
		const at = project(plan.transform, centre);
		// A raster pixel spans `unit` plan units.
		const metresPerImagePixel =
			(groundDistance(
				at,
				project(plan.transform, [centre[0] + step, centre[1]]),
			) /
				step) *
			raster.unit;
		// Ground size of a device pixel: the 512 px world at this zoom, at this latitude.
		const metresPerDevicePixel =
			(2 * Math.PI * EARTH_RADIUS * Math.cos((at[1] * Math.PI) / 180)) /
			(512 * 2 ** this.#map.getZoom()) /
			(window.devicePixelRatio || 1);
		return pyramidLevel(
			metresPerDevicePixel / metresPerImagePixel,
			raster.image.levels.length,
			this.#shown.get(plan.id)?.level,
		);
	}

	/** The part of the map drawn: the view and a margin around it. */
	#bounds(): Bounds {
		const view = this.#map.getBounds();
		const width = view.getEast() - view.getWest();
		const height = view.getNorth() - view.getSouth();
		return {
			west: view.getWest() - width * VIEW_MARGIN,
			south: view.getSouth() - height * VIEW_MARGIN,
			east: view.getEast() + width * VIEW_MARGIN,
			north: view.getNorth() + height * VIEW_MARGIN,
		};
	}

	/**
	 * Draws a raster plan's tiles on screen at the level the zoom calls for, decoding those
	 * stored; while some aren't decoded yet, the nearest coarser level decoded there goes
	 * under them (the coarsest, decoded first, when none is).
	 */
	#showRaster(plan: FloorPlan, raster: RasterContent, bounds: Bounds): void {
		const before = this.#shown.get(plan.id);
		const levels = raster.image.levels;
		const level = this.#pyramidLevel(plan, raster);
		const onScreen = (l: number) =>
			visibleTiles(
				(levels[l]?.tiles ?? []).map((entry, i) => ({
					tile: entry.tile,
					entry,
					id: `${FLOORPLAN_PREFIX}${plan.id}-${l}-${i}`,
				})),
				plan.transform,
				raster.unit,
				bounds,
			);
		const sharp = onScreen(level);
		const ready = ({ entry }: { entry: PlanTile }) =>
			Boolean(entry.bitmap ?? this.#tiles?.peek(entry));
		let under: typeof sharp = [];
		if (!sharp.every(ready)) {
			for (const s of sharp) this.#request(s.entry);
			for (let l = level + 1; l < levels.length; l++) {
				const tiles = onScreen(l);
				if (tiles.every(ready)) {
					under = tiles;
					break;
				}
				if (l === levels.length - 1)
					for (const t of tiles) this.#request(t.entry);
			}
		}
		const drawn = [...under, ...sharp.filter(ready)];
		const tiles = new Map(drawn.map(({ id, entry }) => [id, entry]));
		for (const id of before?.tiles?.keys() ?? []) {
			if (tiles.has(id)) continue;
			if (this.#map.getLayer(id)) this.#map.removeLayer(id);
			if (this.#map.getSource(id)) this.#map.removeSource(id);
		}
		const moved = before?.plan.transform !== plan.transform;
		const faded = before?.plan.opacity !== plan.opacity;
		for (const { id, entry } of drawn) {
			const corners = tileCorners(plan.transform, entry.tile, raster.unit);
			if (!before?.tiles?.has(id)) {
				const image = entry.bitmap ?? this.#tiles?.peek(entry);
				if (!image) continue;
				this.#map.addSource(id, { type: "image", coordinates: corners });
				const source = this.#map.getSource<ImageSource>(id);
				source?.setWarp("perspective");
				source?.updateImage({ image });
				this.#map.addLayer(
					{
						id,
						type: "raster",
						source: id,
						paint: {
							"raster-opacity": plan.opacity,
							"raster-fade-duration": 0,
						},
					},
					this.#below(),
				);
				continue;
			}
			if (moved) {
				this.#map.getSource<ImageSource>(id)?.setCoordinates(corners);
			}
			if (faded) this.#map.setPaintProperty(id, "raster-opacity", plan.opacity);
		}
		this.#shown.set(plan.id, {
			plan,
			raster,
			ids: [...tiles.keys()],
			level,
			tiles,
		});
	}

	/** Decodes a stored tile, then draws again. */
	#request(entry: PlanTile): void {
		const cache = this.#tiles;
		if (!entry.blob || !cache || cache.peek(entry)) return;
		cache.load(entry, entry.blob).then(
			(bitmap) => {
				if (bitmap) this.#schedule();
			},
			() => {
				// A tile that can't be decoded stays blank; the coarser level shows there.
			},
		);
	}

	#showVector(plan: FloorPlan, content: VectorContent): void {
		const id = `${FLOORPLAN_PREFIX}${plan.id}-vector`;
		const hidden = new Set(plan.hiddenLayers);
		const layer = new VectorPlanLayer(
			id,
			content,
			plan.transform,
			plan.opacity,
			hidden,
		);
		this.#map.addLayer(layer, this.#below());
		const ids = [id];
		if (content.texts.length > 0) {
			// The source and its layer share an id, as a raster tile's do.
			const labels = `${id}-labels`;
			this.#map.addSource(labels, {
				type: "geojson",
				data: planLabels(content, plan.transform, hidden),
			});
			this.#map.addLayer(
				planLabelLayer(labels, labels, plan.opacity),
				this.#below(),
			);
			ids.push(labels);
		}
		this.#shown.set(plan.id, {
			plan,
			vector: { content, layer },
			ids,
			level: 0,
		});
	}

	/** A vector plan moved, faded or with layers hidden. */
	#update(shown: Shown, plan: FloorPlan): void {
		if (shown.vector) {
			const { content, layer } = shown.vector;
			const labels = shown.ids[1];
			const moved = plan.transform !== shown.plan.transform;
			const hiddenChanged = plan.hiddenLayers !== shown.plan.hiddenLayers;
			if (moved) layer.setTransform(plan.transform);
			if (hiddenChanged) layer.setHiddenLayers(new Set(plan.hiddenLayers));
			if (labels && (moved || hiddenChanged)) {
				this.#map
					.getSource<GeoJSONSource>(labels)
					?.setData(
						planLabels(content, plan.transform, new Set(plan.hiddenLayers)),
					);
			}
			if (plan.opacity !== shown.plan.opacity) {
				layer.setOpacity(plan.opacity);
				if (labels) {
					this.#map.setPaintProperty(
						labels,
						"text-opacity",
						labelOpacity(plan.opacity),
					);
				}
			}
			this.#shown.set(plan.id, { ...shown, plan });
		}
	}

	#hide(id: string): void {
		// A vector plan's layer has no source; a raster tile's layer is named as its source.
		for (const layer of this.#shown.get(id)?.ids ?? []) {
			if (this.#map.getLayer(layer)) this.#map.removeLayer(layer);
			if (this.#map.getSource(layer)) this.#map.removeSource(layer);
		}
		this.#shown.delete(id);
	}

	/** Plans go in their slot: over indoor fills, under indoor outlines. */
	#below(): string {
		return slotId("plans");
	}
}

/**
 * The map layers of a layer stack, bottom first: each drawn plan's tiles (`tilesOf`), and the
 * building outlines' layer in its place.
 */
export function stackLayerIds(
	layers: readonly LayerEntry[],
	tilesOf: (planId: string) => readonly string[],
	buildingsLayer: string,
): string[] {
	return layers.flatMap((l) =>
		l.kind === "plan" ? [...tilesOf(l.plan.id)] : [buildingsLayer],
	);
}

const TOOL_SOURCE = "floorplan-tool";
/** How far above the plan's top edge its rotation handle sits, in plan heights. */
export const ROTATE_HANDLE_OFFSET = 0.08;

/**
 * The tools' points, handles included: corners (`role: "handle"`, `corner` 0–3) and the
 * rotation handle (`role: "rotate"`).
 */
export const HANDLES_LAYER = `${TOOL_SOURCE}-points`;

/**
 * Frames of the plans shown on `level` (`role: "frame"`), each in the plan's colour, so that
 * plans are told apart in floor plan mode.
 */
export function planFrames(
	plans: readonly FloorPlan[],
	level: number,
): FeatureCollection<LineString> {
	return {
		type: "FeatureCollection",
		features: plans
			.filter((p) => p.visible && isPlanOnLevel(p, level))
			.map((plan) => {
				const frame = corners(
					plan.transform,
					plan.size.width,
					plan.size.height,
				);
				return {
					type: "Feature",
					geometry: { type: "LineString", coordinates: [...frame, frame[0]] },
					properties: { role: "frame", color: plan.color },
				};
			}),
	};
}

/**
 * Marks of the alignment tools, in the plan's colour: control points, measured spots, the
 * rotation pin, and with `handles` the corner handles and the rotation handle to drag. While measuring, a line follows
 * the `pointer` from the first spot (`role: "rubber"`), then joins the two spots
 * (`role: "measured"`).
 */
export function toolFeatures(
	plan: FloorPlan | null,
	tool: Tool | null,
	handles = false,
	pointer?: LngLat | null,
): FeatureCollection<Point | LineString> {
	const features: Feature<Point | LineString>[] = [];
	if (!plan) return { type: "FeatureCollection", features };
	const { color } = plan;
	const point = (
		position: LngLat,
		role: string,
		extra: Record<string, unknown> = {},
	) =>
		features.push({
			type: "Feature",
			geometry: { type: "Point", coordinates: position },
			properties: { role, color, ...extra },
		});
	const line = (from: LngLat, to: LngLat, role = "link") =>
		features.push({
			type: "Feature",
			geometry: { type: "LineString", coordinates: [from, to] },
			properties: { role, color },
		});
	const at = (pixel: Pixel) => project(plan.transform, pixel);
	if (handles) {
		const { width, height } = plan.size;
		for (const [i, corner] of corners(
			plan.transform,
			width,
			height,
		).entries()) {
			point(corner, "handle", { corner: i });
		}
		point(at([width / 2, -ROTATE_HANDLE_OFFSET * height]), "rotate");
	}
	plan.controlPoints.forEach(({ image, map }, i) => {
		const onPlan = at(image);
		line(onPlan, map);
		point(onPlan, "plan", { label: String(i + 1) });
		point(map, "target", { label: String(i + 1) });
	});
	if (tool?.kind === "points" && tool.pending) {
		point(at(tool.pending), "plan", { label: "?" });
	}
	if (tool?.kind === "measure") {
		const [a, b] = tool.points.map(at);
		if (a && b) line(a, b, "measured");
		else if (a && pointer) line(a, pointer, "rubber");
		for (const p of [a, b]) if (p) point(p, "plan");
	}
	if (tool?.kind === "rotate" && tool.pin) {
		point(at(tool.pin), "target");
	}
	return { type: "FeatureCollection", features };
}

/** Draws `toolFeatures` above the indoor data. */
export class PlanToolLayer {
	readonly #map: MapLibreMap;
	#data: FeatureCollection = { type: "FeatureCollection", features: [] };
	#ready = false;
	/** Removed before the style was ready: never installed. */
	#removed = false;

	constructor(map: MapLibreMap) {
		this.#map = map;
		const install = () => {
			map.addSource(TOOL_SOURCE, { type: "geojson", data: this.#data });
			// Over everything else: the marks are what the user is working with.
			const tools = slotId("tools");
			map.addLayer(
				{
					id: `${TOOL_SOURCE}-frame`,
					type: "line",
					source: TOOL_SOURCE,
					filter: ["==", ["get", "role"], "frame"],
					paint: { "line-color": PLAN_COLOR, "line-width": 2 },
				},
				tools,
			);
			map.addLayer(
				{
					id: `${TOOL_SOURCE}-measured`,
					type: "line",
					source: TOOL_SOURCE,
					filter: ["==", ["get", "role"], "measured"],
					paint: { "line-color": PLAN_COLOR, "line-width": 2 },
				},
				tools,
			);
			map.addLayer(
				{
					id: `${TOOL_SOURCE}-links`,
					type: "line",
					source: TOOL_SOURCE,
					filter: ["in", ["get", "role"], ["literal", ["link", "rubber"]]],
					paint: {
						"line-color": PLAN_COLOR,
						"line-width": 2,
						"line-dasharray": [2, 2],
					},
				},
				tools,
			);
			map.addLayer(
				{
					id: HANDLES_LAYER,
					type: "circle",
					source: TOOL_SOURCE,
					filter: ["==", ["geometry-type"], "Point"],
					paint: {
						"circle-radius": [
							"match",
							["get", "role"],
							["handle", "rotate"],
							7,
							6,
						],
						"circle-color": [
							"match",
							["get", "role"],
							["target", "rotate"],
							PLAN_COLOR,
							"#ffffff",
						],
						"circle-stroke-color": PLAN_COLOR,
						"circle-stroke-width": 2,
					},
				},
				tools,
			);
			this.#ready = true;
		};
		void slotsReady(map).then(() => {
			if (!this.#removed) install();
		});
	}

	setData(data: FeatureCollection): void {
		this.#data = data;
		if (this.#ready) {
			this.#map.getSource<GeoJSONSource>(TOOL_SOURCE)?.setData(data);
		}
	}

	remove(): void {
		this.#removed = true;
		if (!this.#ready) return;
		for (const id of [
			HANDLES_LAYER,
			`${TOOL_SOURCE}-links`,
			`${TOOL_SOURCE}-measured`,
			`${TOOL_SOURCE}-frame`,
		]) {
			if (this.#map.getLayer(id)) this.#map.removeLayer(id);
		}
		if (this.#map.getSource(TOOL_SOURCE)) this.#map.removeSource(TOOL_SOURCE);
	}
}

/** Each mark is drawn in the colour of its plan. */
const PLAN_COLOR: ExpressionSpecification = ["get", "color"];
