/**
 * Floor plans shown under the indoor data: their images, where they sit on the map, and how
 * they are shown. Plans are replaced, never mutated, so the map layers can tell what changed.
 */

import { SvelteMap } from "svelte/reactivity";
import type { PlanCodec } from "#lib/floorplans/codec.ts";
import { pickColor } from "#lib/floorplans/colors.ts";
import {
	closeContent,
	type PlanContent,
	type PlanOrigin,
	type PlanSize,
	type PlanSource,
	rasterContent,
	tilesOf,
} from "#lib/floorplans/content.ts";
import {
	type ControlPoint,
	type Fit,
	fitPlan,
	GeorefError,
	type LngLat,
	moveTo,
	offsetBy,
	type Pixel,
	type PlanPosition,
	place,
	rotateAbout,
	scaleToDistance,
	type Transform,
	type TransformKind,
	translateTo,
	unproject,
} from "#lib/floorplans/georef.ts";
import type { ImportedPlans } from "#lib/floorplans/plan-io.ts";
import { PlanVertices } from "#lib/floorplans/plan-vertices.ts";
import { TileCache } from "#lib/floorplans/tile-cache.ts";
import type { Bounds } from "#lib/floorplans/tiling.ts";
import type { VectorContent } from "#lib/floorplans/vector.ts";
import { type Message, msg } from "#lib/i18n/messages.ts";
import { isOnLevel, parseLevels } from "#lib/levels/levels.ts";
import {
	fileOf,
	type PlanStore,
	type StoredPlan,
} from "#lib/persist/plan-store.ts";

export interface FloorPlan {
	readonly id: string;
	readonly name: string;
	/** Its size in plan units (the transform's units); its content is in `FloorPlans.contents`. */
	readonly size: PlanSize;
	/** The file it was imported from, stored apart (`FloorPlans.fileOf`). */
	readonly source: PlanSource;
	readonly transform: Transform;
	readonly controlPoints: readonly ControlPoint[];
	/** Transform fitted to the control points, once there are enough of them. */
	readonly fitKind: TransformKind;
	/** 0 to 1. Half-transparent by default, so the map shows through. */
	readonly opacity: number;
	/** OSM level the plan belongs to, like `0`; null when not assigned. */
	readonly level: string | null;
	readonly visible: boolean;
	/** Colour of its frame, handles and marks: one of `PLAN_COLORS`, `#rrggbb`. */
	readonly color: string;
	/** Ids of the CAD layers (`VectorContent.layers`) not shown. */
	readonly hiddenLayers: readonly string[];
	/** The OSM building (way or relation id) the plan is of, when assigned. */
	readonly building?: string;
}

/** An OSM building a plan can be assigned to (`FloorPlan.building`). */
export type { PlanBuilding } from "#lib/floorplans/buildings.ts";

/** The building outlines' place in the stack: how many plans are under them. */
export interface BuildingsLayer {
	readonly below: number;
	readonly visible: boolean;
}

export type LayerEntry =
	| { readonly kind: "plan"; readonly plan: FloorPlan }
	| { readonly kind: "buildings" };

/** Key of the building outlines in `FloorPlans.move`. */
export const BUILDINGS = "buildings";

export const DEFAULT_OPACITY = 0.5;

/** Control points each kind of fit needs. */
export const MIN_POINTS: Record<TransformKind, number> = {
	similarity: 2,
	affine: 3,
	projective: 4,
};

/**
 * The alignment tool in use, and how far along it is:
 * - `points`: click a spot on the plan, then where it really is on the map;
 * - `measure`: click two spots on the plan, then give their real distance;
 * - `rotate`: click the spot to turn around, then give an angle.
 */
export type Tool =
	| { readonly kind: "points"; readonly pending: Pixel | null }
	| { readonly kind: "measure"; readonly points: readonly Pixel[] }
	| { readonly kind: "rotate"; readonly pin: Pixel | null };

/** The part of the view height a new plan takes. */
const INITIAL_HEIGHT = 0.6;

export interface View {
	readonly center: LngLat;
	/** Height of the visible map, in ground metres. */
	readonly heightMetres: number;
}

export interface FloorPlansOptions {
	/** Where plans are saved; without it they last until the page is closed. */
	readonly store?: PlanStore;
	/** Decodes stored tiles and plans saved as one image; needed to restore. */
	readonly codec?: PlanCodec;
}

export class FloorPlans {
	plans = $state.raw<readonly FloorPlan[]>([]);
	/** Each plan's content, by id: large, so kept out of the plans (values aren't proxied). */
	readonly contents = new SvelteMap<string, PlanContent>();
	/** Each plan's thumbnail, by id, for the list. */
	readonly thumbnails = new SvelteMap<string, Blob>();
	/** Stored tiles decoded for the map, within a memory budget. */
	readonly tiles: TileCache;
	/** Set when plans could not be saved or restored. */
	storageError = $state.raw<Message | null>(null);
	/** The building outlines' entry in the layer stack: how many plans are drawn under them. */
	buildings = $state.raw<BuildingsLayer>({ below: 0, visible: true });
	/** The layer stack of floor plan mode, bottom first: the plans and the building outlines. */
	readonly layers = $derived.by((): LayerEntry[] => {
		const entries: LayerEntry[] = this.plans.map((plan) => ({
			kind: "plan",
			plan,
		}));
		entries.splice(this.buildings.below, 0, { kind: "buildings" });
		return entries;
	});
	/**
	 * The plan in Edit, the only one that can be changed; other plans are locked. Its changes are
	 * kept out of storage until Done, and Cancel puts it back as it was when Edit was pressed.
	 */
	editingId = $state<string | null>(null);
	readonly editing = $derived(
		this.plans.find((p) => p.id === this.editingId) ?? null,
	);
	/** The plan in Edit as it was when Edit was pressed. */
	#before = $state.raw<FloorPlan | null>(null);
	/** Whether the plan in Edit has changes Done would save. */
	readonly dirty = $derived(
		this.editing !== null && this.editing !== this.#before,
	);
	/** Set while `whenSaved` asks whether to save or discard the plan in Edit. */
	confirming = $state(false);
	#afterConfirm: (() => void) | null = null;
	/** Alignment tool for the plan in Edit; map clicks go to it instead of the indoor data. */
	tool = $state.raw<Tool | null>(null);
	/** How well the plan in Edit fits its control points. */
	readonly fit = $derived.by((): Fit | null => {
		const plan = this.editing;
		if (!plan || plan.controlPoints.length < 2) return null;
		return fitPlan(plan.controlPoints, usableKind(plan));
	});

	readonly #store: PlanStore | undefined;
	readonly #codec: PlanCodec | undefined;
	/** The level the map shows; null until told (everything loaded is kept). */
	#shownLevel: number | null = null;
	/** Plans whose content is loading. */
	readonly #loading = new Set<string>();
	/** Plans whose content isn't saved yet: it is kept, whatever level is shown. */
	readonly #unsaved = new Set<string>();
	/** Plans removed: content still being encoded for one is not saved. */
	readonly #removed = new Set<string>();
	/** Files saved (or being saved) by id: the pages of a PDF save it once. */
	readonly #savedFiles = new Set<string>();
	/** Files not written to the store yet (or kept here without a store), by id. */
	readonly #unwritten = new Map<string, Blob>();
	/** Each vector content's vertices, built when first snapped to, dropped with it. */
	readonly #vertices = new WeakMap<VectorContent, PlanVertices>();

	constructor({ store, codec }: FloorPlansOptions = {}) {
		this.#store = store;
		this.#codec = codec;
		this.tiles = new TileCache((blob) =>
			codec
				? codec.decode(blob)
				: Promise.reject(new Error("No codec to decode tiles")),
		);
	}

	/**
	 * Keeps content only for the plans the map shows on `level` (and the one in Edit), loading
	 * theirs from the store and dropping the others' bitmaps.
	 */
	showLevel(level: number): void {
		this.#shownLevel = level;
		this.#syncContent();
	}

	/** The file a plan was imported from, for exports. */
	async fileOf(plan: {
		readonly source: PlanSource;
	}): Promise<Blob | undefined> {
		const { file } = plan.source;
		return this.#unwritten.get(file) ?? (await this.#store?.loadFile(file));
	}

	/**
	 * The corners and line ends that the visible vector plans on `level` (those `which` takes)
	 * put within `area`: what clicks snap to.
	 */
	verticesNear(
		area: Bounds,
		level: number,
		which: (plan: FloorPlan) => boolean = () => true,
	): LngLat[] {
		return this.plans.flatMap((plan) => {
			const vector = this.contents.get(plan.id)?.vector;
			if (!vector || !plan.visible || !isPlanOnLevel(plan, level)) return [];
			if (!which(plan)) return [];
			let vertices = this.#vertices.get(vector);
			if (!vertices) {
				vertices = new PlanVertices(vector);
				this.#vertices.set(vector, vertices);
			}
			return vertices.near(plan.transform, area, new Set(plan.hiddenLayers));
		});
	}

	/** Brings back the plans saved in earlier visits. */
	async restore(): Promise<void> {
		const store = this.#store;
		if (!store || !this.#codec) return;
		try {
			const [stored, buildings, thumbnails] = await Promise.all([
				store.load(),
				store.loadBuildings(),
				store.loadThumbnails(),
			]);
			for (const [id, blob] of thumbnails) this.thumbnails.set(id, blob);
			// Plans saved before plan units are measured by their image, converted now; one
			// without any content is left out.
			const sized = await Promise.all(
				stored.map(async (record) => {
					const { order: _order, size, ...rest } = record;
					// Plans saved before sources have their file under their own id.
					const source: PlanSource = rest.source ?? {
						kind: "raster",
						file: fileOf(record),
					};
					// Plans saved before layers could be hidden have none hidden.
					const plan = {
						...rest,
						source,
						hiddenLayers: rest.hiddenLayers ?? [],
					};
					if (size) return { plan: { ...plan, size }, resave: false };
					const content = await this.#loadContent({ id: plan.id });
					if (!content) return null;
					this.contents.set(plan.id, content);
					return { plan: { ...plan, size: content.size }, resave: true };
				}),
			);
			const saved = stored.filter((_, i) => sized[i]);
			const decoded = sized.flatMap((s) => (s ? [s.plan] : []));
			const resaved = new Set(
				sized.flatMap((s) => (s?.resave ? [s.plan.id] : [])),
			);
			// Plans saved before they had colours get one, kept from then on.
			const used = [...this.plans, ...decoded].flatMap((p) =>
				p.color ? [p.color] : [],
			);
			const restored = decoded.map((plan): FloorPlan => {
				if (plan.color) return { ...plan, color: plan.color };
				const color = pickColor(used);
				used.push(color);
				resaved.add(plan.id);
				return { ...plan, color };
			});
			// Plans added while restoring stay on top. Without a saved place (saved before the
			// outlines were in the list), the outlines go on top of the plans.
			const below = buildings
				? saved.filter((plan) => plan.order < buildings.order).length
				: restored.length;
			this.plans = [...restored, ...this.plans];
			this.buildings = {
				below,
				visible: buildings?.visible ?? true,
			};
			for (const plan of restored) {
				this.#savedFiles.add(plan.source.file);
				if (resaved.has(plan.id)) this.#save(plan);
			}
			this.#syncContent();
		} catch (e) {
			this.storageError = msg("plan_storage_restore_failed", {
				error: (e as Error).message,
			});
		}
	}

	/**
	 * Adds a plan north up in the middle of the view, 60% of its height tall, in Edit, with the
	 * file it comes from.
	 */
	add(
		content: PlanContent,
		name: string,
		view: View,
		level: string | null,
		{ source, file }: PlanOrigin,
	): void {
		const { width, height } = content.size;
		const transform = place(
			{
				center: view.center,
				metresPerPixel: (view.heightMetres * INITIAL_HEIGHT) / height,
				bearing: 0,
			},
			width,
			height,
		);
		this.insert(
			{
				name,
				size: content.size,
				source,
				transform,
				controlPoints: [],
				fitKind: "similarity",
				opacity: DEFAULT_OPACITY,
				level,
				visible: true,
			},
			content,
			file,
		);
	}

	/**
	 * Adds an already placed plan (from a file) on top of the others, saved as it is and opened in
	 * Edit, with `file`, its source's file, unless saved already. Without a colour, it gets one
	 * no other plan has; without hidden layers, the CAD layers its content has off are hidden.
	 */
	insert(
		fields: Omit<FloorPlan, "id" | "color" | "hiddenLayers"> & {
			readonly color?: string;
			readonly hiddenLayers?: readonly string[];
		},
		content: PlanContent,
		file: Blob,
	): void {
		const plan: FloorPlan = {
			id: crypto.randomUUID(),
			...fields,
			color: fields.color ?? pickColor(this.plans.map((p) => p.color)),
			hiddenLayers:
				fields.hiddenLayers ??
				(content.vector?.layers ?? []).flatMap((l) =>
					l.visible ? [] : [l.id],
				),
		};
		// Above the other plans: under the outlines if they are on top.
		const outlinesOnTop = this.buildings.below === this.plans.length;
		this.plans = [...this.plans, plan];
		if (outlinesOnTop) {
			this.buildings = { ...this.buildings, below: this.plans.length };
			this.#saveBuildings();
		}
		this.contents.set(plan.id, content);
		this.#saveFile(plan.source.file, file);
		this.#save(plan);
		this.edit(plan.id);
		this.#persist(this.#saveContent(plan.id, content));
	}

	#saveFile(id: string, file: Blob): void {
		if (this.#savedFiles.has(id)) return;
		this.#savedFiles.add(id);
		this.#unwritten.set(id, file);
		const write = this.#store?.saveFile(id, file);
		this.#persist(write?.then(() => void this.#unwritten.delete(id)));
	}

	/**
	 * Adds a plan file's plans on top of the others, as `insert` does, and puts the building
	 * outlines where the file had them among its plans.
	 */
	insertPlans({ plans, buildings }: ImportedPlans): void {
		const existing = this.plans.length;
		for (const { content, file, ...fields } of plans) {
			this.insert(fields, content, file);
		}
		if (buildings) {
			this.move(BUILDINGS, existing + Math.min(buildings.below, plans.length));
			this.setBuildingsVisible(buildings.visible);
		}
	}

	/** Whether the map shows a plan now: its content is kept. */
	#wanted(plan: FloorPlan): boolean {
		const level = this.#shownLevel;
		return (
			level === null ||
			plan.id === this.editingId ||
			(plan.visible && isPlanOnLevel(plan, level))
		);
	}

	#syncContent(): void {
		const wanted = new Set(
			this.plans.filter((p) => this.#wanted(p)).map((p) => p.id),
		);
		for (const id of [...this.contents.keys()]) {
			if (wanted.has(id) || this.#unsaved.has(id)) continue;
			this.#close(this.contents.get(id));
			this.contents.delete(id);
		}
		for (const id of wanted) {
			if (!this.contents.has(id) && !this.#loading.has(id)) void this.#load(id);
		}
	}

	async #load(id: string): Promise<void> {
		this.#loading.add(id);
		try {
			const plan = this.plans.find((p) => p.id === id);
			const content = plan && (await this.#loadContent(plan));
			const now = this.plans.find((p) => p.id === id);
			if (content && now && this.#wanted(now) && !this.contents.has(id)) {
				this.contents.set(id, content);
			} else {
				this.#close(content);
			}
		} catch (e) {
			this.storageError = msg("plan_storage_restore_failed", {
				error: (e as Error).message,
			});
		} finally {
			this.#loading.delete(id);
		}
	}

	/**
	 * A plan's content from the store, decoded. An image saved before schema 3 is converted:
	 * cut, encoded and saved as content, measured in its pixels unless `size` says otherwise.
	 */
	async #loadContent(plan: {
		readonly id: string;
		readonly size?: PlanSize;
	}): Promise<PlanContent | undefined> {
		const codec = this.#codec;
		const vector = await this.#store?.loadVector(plan.id);
		if (vector) return { size: plan.size ?? vector.size, vector };
		const stored = await this.#store?.loadContent(plan.id);
		if (!stored || !codec) return undefined;
		if (stored.kind === "legacy") {
			const { image } = await codec.decodeFile(stored.image);
			const content = rasterContent(image, plan.size);
			// The image is kept as the plan's file, under its id.
			const store = this.#store;
			this.#persist(
				store
					?.saveFile(plan.id, stored.image)
					.then(() => this.#saveContent(plan.id, content)),
			);
			return content;
		}
		// Tiles stay encoded until the map shows them (`tiles`).
		const { raster, thumbnail } = stored;
		return {
			size: plan.size ?? {
				width: raster.width * raster.unit,
				height: raster.height * raster.unit,
			},
			raster: {
				unit: raster.unit,
				image: {
					width: raster.width,
					height: raster.height,
					levels: raster.levels,
					encoded: Promise.resolve({
						levels: raster.levels,
						...(thumbnail ? { thumbnail } : {}),
					}),
				},
			},
		};
	}

	/** Frees a content's bitmaps: those cut, and those decoded for the map. */
	#close(content: PlanContent | undefined): void {
		closeContent(content);
		this.tiles.forget(tilesOf(content));
	}

	/**
	 * Saves a plan's content once its tiles are encoded (the plan shows meanwhile), with its
	 * thumbnail.
	 */
	async #saveContent(id: string, content: PlanContent): Promise<void> {
		const store = this.#store;
		const { raster, vector } = content;
		if (!raster && !vector) return;
		// Kept until saved: without a store, for as long as the plan lasts.
		this.#unsaved.add(id);
		if (!store) return;
		if (vector) {
			const thumbnail = await this.#codec?.vectorThumbnail(vector);
			if (this.#removed.has(id)) return;
			if (thumbnail) this.thumbnails.set(id, thumbnail);
			await store.saveVector(id, vector, thumbnail);
			this.#unsaved.delete(id);
			this.#syncContent();
			return;
		}
		if (!raster) return;
		const { image, unit } = raster;
		const { levels, thumbnail } = await image.encoded;
		// Removed while its tiles were encoded: nothing to save.
		if (this.#removed.has(id)) return;
		if (thumbnail) this.thumbnails.set(id, thumbnail);
		await store.saveContent(id, {
			kind: "raster",
			raster: { unit, width: image.width, height: image.height, levels },
			...(thumbnail ? { thumbnail } : {}),
		});
		this.#unsaved.delete(id);
		this.#syncContent();
	}

	/**
	 * Opens a plan in Edit. Unsaved changes to another plan in Edit are dropped: ask first with
	 * `whenSaved`.
	 */
	edit(id: string): void {
		if (this.editingId) this.cancel();
		const plan = this.plans.find((p) => p.id === id);
		if (!plan) return;
		this.editingId = id;
		this.#before = plan;
		this.#syncContent();
	}

	/** Saves the plan in Edit and locks it again. */
	done(): void {
		const plan = this.editing;
		this.#endEdit();
		if (plan) this.#save(plan);
	}

	/** Puts the plan in Edit back as it was when Edit was pressed, and locks it again. */
	cancel(): void {
		const before = this.#before;
		if (before) {
			this.plans = this.plans.map((p) => (p.id === before.id ? before : p));
		}
		this.#endEdit();
	}

	#endEdit(): void {
		this.editingId = null;
		this.#before = null;
		this.tool = null;
		this.#syncContent();
	}

	/**
	 * Runs `action` once the plan in Edit has no unsaved changes: at once, or after asking to
	 * save or discard them (`confirming`, answered with `resolve`).
	 */
	whenSaved(action: () => void): void {
		if (!this.dirty) {
			action();
			return;
		}
		this.#afterConfirm = action;
		this.confirming = true;
	}

	/** The answer to `whenSaved`'s question; "keep" goes back to editing and drops the action. */
	resolve(choice: "save" | "discard" | "keep"): void {
		const action = this.#afterConfirm;
		this.#afterConfirm = null;
		this.confirming = false;
		if (choice === "keep") return;
		if (choice === "save") this.done();
		else this.cancel();
		action?.();
	}

	/** Shows or hides a plan, saved at once: not part of an edit session. */
	setVisible(id: string, visible: boolean): void {
		this.#setAtOnce(id, { visible });
	}

	/** Hides these CAD layers of a plan (by id) and shows the others, saved at once. */
	setHiddenLayers(id: string, hiddenLayers: readonly string[]): void {
		this.#setAtOnce(id, { hiddenLayers });
	}

	/** A change saved at once, outside any edit session: Cancel keeps it. */
	#setAtOnce(
		id: string,
		changes: Partial<Pick<FloorPlan, "visible" | "hiddenLayers">>,
	): void {
		const plan = this.plans.find((p) => p.id === id);
		if (!plan) return;
		const changed = { ...plan, ...changes };
		const before = this.#before;
		if (id === this.editingId && before) {
			// Storage gets it without the changes still in Edit.
			this.#before = this.dirty ? { ...before, ...changes } : changed;
			this.#save(this.#before);
		} else {
			this.#save(changed);
		}
		this.plans = this.plans.map((p) => (p.id === id ? changed : p));
		this.#syncContent();
	}

	setTool(kind: Tool["kind"] | null): void {
		if (!this.editing) {
			this.tool = null;
			return;
		}
		switch (kind) {
			case "points":
				this.tool = { kind, pending: null };
				break;
			case "measure":
				this.tool = { kind, points: [] };
				break;
			case "rotate":
				this.tool = { kind, pin: null };
				break;
			default:
				this.tool = null;
		}
	}

	/**
	 * A click on the map while a tool is active, at `position` (already snapped to an OSM node
	 * when close to one). Returns a message when the click can't be used.
	 */
	click(position: LngLat): Message | null {
		const plan = this.editing;
		const tool = this.tool;
		if (!plan || !tool) return null;
		const onPlan = pixelOn(plan, position);
		switch (tool.kind) {
			case "points":
				if (!tool.pending) {
					if (!onPlan) return msg("plan_tool_click_plan_first");
					this.tool = { kind: "points", pending: onPlan };
				} else {
					this.#setControlPoints(plan, [
						...plan.controlPoints,
						{ image: tool.pending, map: position },
					]);
					this.tool = { kind: "points", pending: null };
				}
				return null;
			case "measure":
				if (!onPlan) return msg("plan_tool_measure_on_plan");
				this.tool = {
					kind: "measure",
					points: tool.points.length >= 2 ? [onPlan] : [...tool.points, onPlan],
				};
				return null;
			case "rotate":
				if (!onPlan) return msg("plan_tool_pivot_on_plan");
				this.tool = { kind: "rotate", pin: onPlan };
				return null;
		}
	}

	removeControlPoint(index: number): void {
		const plan = this.editing;
		if (!plan) return;
		this.#setControlPoints(
			plan,
			plan.controlPoints.filter((_, i) => i !== index),
		);
	}

	/**
	 * Removes every control point of the plan in Edit, which stays where they put it, and the
	 * active tool's half-done pick.
	 */
	clearPoints(): void {
		const plan = this.editing;
		if (plan && plan.controlPoints.length > 0) {
			this.#replace({ ...plan, controlPoints: [] });
		}
		if (this.tool) this.setTool(this.tool.kind);
	}

	setFitKind(fitKind: TransformKind): void {
		const plan = this.editing;
		if (!plan) return;
		this.#setControlPoints({ ...plan, fitKind }, plan.controlPoints);
	}

	/** Scales the plan in Edit so the two measured spots are `metres` apart. */
	scaleTo(metres: number): void {
		const plan = this.editing;
		const tool = this.tool;
		if (!plan || tool?.kind !== "measure") return;
		const [a, b] = tool.points;
		if (!a || !b) return;
		this.#place(plan, scaleToDistance(plan.transform, a, b, metres));
		this.tool = { kind: "measure", points: [] };
	}

	/** Shows the plan in Edit at a new place while it is being dragged. */
	preview(id: string, transform: Transform): void {
		if (id !== this.editingId) return;
		this.plans = this.plans.map((p) => (p.id === id ? { ...p, transform } : p));
	}

	/** Where the plan in Edit was dropped: its control points no longer match, and go. */
	commitPlacement(id: string): void {
		const plan = this.editing;
		if (plan?.id === id) this.#place(plan, plan.transform);
	}

	/** Moves the plan in Edit `east` and `north` metres (negative: west, south). */
	offset(east: number, north: number): void {
		const plan = this.editing;
		if (!plan || (east === 0 && north === 0)) return;
		const { width, height } = plan.size;
		this.#place(plan, offsetBy(plan.transform, width, height, east, north));
	}

	/** Assigns the plan in Edit to an OSM building, by its id, or to none. */
	setBuilding(building: string | null): void {
		const plan = this.editing;
		if (!plan) return;
		const { building: _old, ...rest } = plan;
		this.#replace(building ? { ...rest, building } : rest);
	}

	/** Moves, turns or scales the plan in Edit to a position typed in numbers. */
	setPosition(changes: Partial<PlanPosition>): void {
		const plan = this.editing;
		if (!plan) return;
		const { width, height } = plan.size;
		this.#place(plan, moveTo(plan.transform, width, height, changes));
	}

	/** Turns the plan in Edit clockwise around the picked spot. */
	rotate(degrees: number): void {
		const plan = this.editing;
		const tool = this.tool;
		if (!plan || tool?.kind !== "rotate" || !tool.pin) return;
		this.#place(plan, rotateAbout(plan.transform, tool.pin, degrees));
	}

	/**
	 * New control points: one moves the plan onto it, two or more fit the plan to them. Without
	 * any, the plan stays where it is.
	 */
	#setControlPoints(
		plan: FloorPlan,
		controlPoints: readonly ControlPoint[],
	): void {
		let { transform } = plan;
		const [first] = controlPoints;
		if (controlPoints.length === 1 && first) {
			transform = translateTo(transform, first.image, first.map);
		} else if (controlPoints.length >= 2) {
			transform = fitPlan(
				controlPoints,
				usableKind({ ...plan, controlPoints }),
			).transform;
		}
		this.#replace({ ...plan, controlPoints, transform });
	}

	/**
	 * Moves a plan by hand (scale, rotation). Control points no longer match the new place, so
	 * they are dropped.
	 */
	#place(plan: FloorPlan, transform: Transform): void {
		this.#replace({ ...plan, transform, controlPoints: [] });
	}

	/** A change to the plan in Edit, saved by Done. */
	#replace(plan: FloorPlan): void {
		this.plans = this.plans.map((p) => (p.id === plan.id ? plan : p));
		this.#syncContent();
	}

	/** Changes the plan in Edit; locked plans are left alone. */
	update(
		id: string,
		changes: Partial<
			Omit<FloorPlan, "id" | "size" | "visible" | "hiddenLayers">
		>,
	): void {
		const plan = this.editing;
		if (plan?.id === id) this.#replace({ ...plan, ...changes });
	}

	remove(id: string): void {
		this.#removed.add(id);
		this.#unsaved.delete(id);
		const index = this.plans.findIndex((p) => p.id === id);
		const file = this.plans[index]?.source.file;
		this.plans = this.plans.filter((p) => p.id !== id);
		// The store deletes a file with the last plan from it: imported again, it is saved again.
		if (file && !this.plans.some((p) => p.source.file === file)) {
			this.#savedFiles.delete(file);
			this.#unwritten.delete(file);
		}
		if (index >= 0 && index < this.buildings.below) {
			// Saved places keep their order: nothing to save.
			this.buildings = { ...this.buildings, below: this.buildings.below - 1 };
		}
		if (this.editingId === id) this.#endEdit();
		this.#close(this.contents.get(id));
		this.contents.delete(id);
		this.thumbnails.delete(id);
		this.#persist(this.#store?.delete(id));
	}

	/** Moves a plan (by id) or the outlines (`BUILDINGS`) to `index` in the stack, bottom first. */
	move(key: string, index: number): void {
		const keys = this.layers.map((l) =>
			l.kind === "plan" ? l.plan.id : BUILDINGS,
		);
		const from = keys.indexOf(key);
		if (from < 0) return;
		const to = Math.max(0, Math.min(keys.length - 1, Math.round(index)));
		if (to === from) return;
		keys.splice(from, 1);
		keys.splice(to, 0, key);
		const byId = new Map(this.plans.map((p) => [p.id, p]));
		this.plans = keys.flatMap((k) => byId.get(k) ?? []);
		this.buildings = { ...this.buildings, below: keys.indexOf(BUILDINGS) };
		// Every place may have changed, saved in one write; the plan in Edit is saved as it was
		// when Edit was pressed.
		const before = this.#before;
		const { below, visible } = this.buildings;
		this.#persist(
			this.#store?.saveStack(
				this.plans.map((plan) =>
					this.#stored(plan.id === this.editingId && before ? before : plan),
				),
				{ order: below, visible },
			),
		);
	}

	/** Shows or hides the building outlines in floor plan mode, saved at once. */
	setBuildingsVisible(visible: boolean): void {
		this.buildings = { ...this.buildings, visible };
		this.#saveBuildings();
	}

	#saveBuildings(): void {
		const { below, visible } = this.buildings;
		this.#persist(this.#store?.saveBuildings({ order: below, visible }));
	}

	#save(plan: FloorPlan): void {
		this.#persist(this.#store?.save(this.#stored(plan)));
	}

	/** A plan's settings as stored: everything but its image, and its place in the stack. */
	#stored(plan: FloorPlan): StoredPlan {
		const index = this.plans.findIndex((p) => p.id === plan.id);
		// The outlines take a place in the stack too.
		return {
			...plan,
			order: index + (index >= this.buildings.below ? 1 : 0),
		};
	}

	/** Reports a failed write: plans stay usable, but won't survive a reload. */
	#persist(write: Promise<void> | undefined): void {
		write?.catch((e: Error) => {
			this.storageError = msg("plan_storage_save_failed", { error: e.message });
		});
	}
}

/** The plan's fit kind if it has enough control points, else the simplest fit. */
function usableKind(plan: FloorPlan): TransformKind {
	return plan.controlPoints.length >= MIN_POINTS[plan.fitKind]
		? plan.fitKind
		: "similarity";
}

/** The pixel of the plan at a map position, or null when the position is off the plan. */
function pixelOn(plan: FloorPlan, position: LngLat): Pixel | null {
	try {
		const [u, v] = unproject(plan.transform, position);
		const { width, height } = plan.size;
		return u >= 0 && v >= 0 && u <= width && v <= height ? [u, v] : null;
	} catch (e) {
		if (e instanceof GeorefError) return null;
		throw e;
	}
}

/**
 * Whether a plan shows on a level: plans without a level, or with one that can't be read, show
 * everywhere rather than vanish.
 */
export function isPlanOnLevel(plan: FloorPlan, level: number): boolean {
	const levels = plan.level === null ? null : parseLevels(plan.level);
	return levels === null || isOnLevel(levels, level);
}
