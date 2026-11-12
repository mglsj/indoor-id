<script lang="ts">
	import ClipboardPaste from "@lucide/svelte/icons/clipboard-paste";
	import Combine from "@lucide/svelte/icons/combine";
	import Copy from "@lucide/svelte/icons/copy";
	import FileImage from "@lucide/svelte/icons/file-image";
	import Layers2 from "@lucide/svelte/icons/layers-2";
	import MapPin from "@lucide/svelte/icons/map-pin";
	import Pentagon from "@lucide/svelte/icons/pentagon";
	import RectangleHorizontal from "@lucide/svelte/icons/rectangle-horizontal";
	import Redo2 from "@lucide/svelte/icons/redo-2";
	import Ruler from "@lucide/svelte/icons/ruler";
	import Scissors from "@lucide/svelte/icons/scissors";
	import Spline from "@lucide/svelte/icons/spline";
	import Square from "@lucide/svelte/icons/square";
	import SquaresSubtract from "@lucide/svelte/icons/squares-subtract";
	import Trash from "@lucide/svelte/icons/trash";
	import Undo2 from "@lucide/svelte/icons/undo-2";
	import Unlink from "@lucide/svelte/icons/unlink";
	import Upload from "@lucide/svelte/icons/upload";
	import { type Component, untrack } from "svelte";
	import { innerWidth } from "svelte/reactivity/window";
	import type { Clipboard } from "#lib/actions/copy.ts";
	import { splitAreas, splitTargets } from "#lib/actions/split-areas.ts";
	import { OsmApi } from "#lib/api/osm-api.ts";
	import { OsmWikibase } from "#lib/api/osm-wikibase.ts";
	import { RecentUploads } from "#lib/api/recent-uploads.ts";
	import { Taginfo } from "#lib/api/taginfo.ts";
	import { searchWikipedia, Wikidata } from "#lib/api/wikidata.ts";
	import { Badge } from "#lib/components/shadcn/badge/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as ButtonGroup from "#lib/components/shadcn/button-group/index.ts";
	import * as Tooltip from "#lib/components/shadcn/tooltip/index.ts";
	import type { EditorConfig } from "#lib/config.ts";
	import { featureDrag } from "#lib/edit/feature-drag.ts";
	import {
		formatCombo,
		isForMap,
		isMac,
		isTyping,
		matches,
	} from "#lib/edit/keys.ts";
	import { featuresInLasso, lassoDrag } from "#lib/edit/lasso.ts";
	import type { MapPoint } from "#lib/edit/mode.ts";
	import { ModeManager } from "#lib/edit/mode-manager.ts";
	import { browseMode } from "#lib/edit/modes/browse.ts";
	import {
		drawPointMode,
		drawWayMode,
		type SnapConstraints,
	} from "#lib/edit/modes/draw.ts";
	import {
		floorPlanMode,
		floorPlanToolMode,
	} from "#lib/edit/modes/floorplan.ts";
	import { type FramePick, framePickMode } from "#lib/edit/modes/frame-pick.ts";
	import { type MeasureVariant, measureMode } from "#lib/edit/modes/measure.ts";
	import {
		drawRectangleMode,
		type RectangleVariant,
	} from "#lib/edit/modes/rectangle.ts";
	import { splitMode } from "#lib/edit/modes/split.ts";
	import { type NodeGrab, nodeDrag } from "#lib/edit/node-drag.ts";
	import {
		OPERATIONS,
		type Operation,
		type OperationContext,
	} from "#lib/edit/operations.ts";
	import {
		cutFeature,
		floorFeature,
		overlayFeatures,
	} from "#lib/edit/overlay.ts";
	import {
		type Feedback,
		inferenceLabel,
	} from "#lib/edit/precision/feedback.ts";
	import {
		bearingOf,
		type Frame,
		foldAngle,
		northFrame,
	} from "#lib/edit/precision/frame.ts";
	import { drawnSpacing, gridLines } from "#lib/edit/precision/grid.ts";
	import { Inferences } from "#lib/edit/precision/inference.ts";
	import {
		areaAround,
		LINE_PIXELS,
		type SnapTarget,
		snapAt,
	} from "#lib/edit/precision/snap.ts";
	import { unmappedFloorAt } from "#lib/edit/unmapped-floor.ts";
	import { buildingName, buildingsUnder } from "#lib/floorplans/buildings.ts";
	import { workerCodec } from "#lib/floorplans/codec.ts";
	import {
		corners,
		groundDistance,
		type LngLat,
		project,
	} from "#lib/floorplans/georef.ts";
	import { planDecoders } from "#lib/floorplans/import.ts";
	import { type Message, msg, t } from "#lib/i18n/messages.ts";
	import type { Imagery } from "#lib/map/backgrounds.ts";
	import { ConstructionLayer } from "#lib/map/construction-layer.ts";
	import { EditOverlay } from "#lib/map/edit-overlay.ts";
	import type { Segment } from "#lib/map/feature-store.ts";
	import {
		FloorPlanLayers,
		PlanToolLayer,
		planFrames,
		toolFeatures,
	} from "#lib/map/floorplan-layers.ts";
	import { GridLayer } from "#lib/map/grid-layer.ts";
	import { GuideLayer } from "#lib/map/guide-layer.ts";
	import { parseHash, type MapView as View } from "#lib/map/hash.ts";
	import type { IndoorMap } from "#lib/map/indoor-map.ts";
	import {
		LngLat as LngLatClass,
		type LngLatLike,
		type Map as MapLibreMap,
	} from "#lib/map/maplibre.ts";
	import {
		visibleExtent as extentOfView,
		projectLoc as project_,
		unprojectPoint as unproject_,
	} from "#lib/map/view.ts";
	import type { EntityId, Loc, NodeId, WayId } from "#lib/osm/entity.ts";
	import { extentOf, extentsIntersect, fromLocal } from "#lib/osm/geometry.ts";
	import { entityExtent } from "#lib/osm/relations.ts";
	import { Autosave } from "#lib/persist/autosave.ts";
	import { IndexedDbPlanStore } from "#lib/persist/plan-store.ts";
	import { EditAutosave } from "#lib/state/autosave.svelte.ts";
	import { performEdit } from "#lib/state/commands.ts";
	import { Editor, setEditor } from "#lib/state/editor.svelte.ts";
	import {
		FloorPlans,
		isPlanOnLevel,
		type View as PlanView,
	} from "#lib/state/floorplans.svelte.ts";
	import { type BuildingFrame, Frames } from "#lib/state/frames.svelte.ts";
	import { Guides } from "#lib/state/guides.svelte.ts";
	import {
		INFERENCE_OPTIONS,
		PrecisionSettings,
		setPrecision,
	} from "#lib/state/precision.svelte.ts";
	import { Session } from "#lib/state/session.svelte.ts";
	import FloorPanel from "#lib/ui/FloorPanel.svelte";
	import FloorPlansPanel from "#lib/ui/FloorPlansPanel.svelte";
	import Inspector from "#lib/ui/Inspector.svelte";
	import MapShell from "#lib/ui/MapShell.svelte";
	import MeasureLabels from "#lib/ui/MeasureLabels.svelte";
	import MultiInspector from "#lib/ui/MultiInspector.svelte";
	import PanelResizer from "#lib/ui/PanelResizer.svelte";
	import {
		clampWidth,
		rememberedWidth,
		rememberWidth,
		widthBounds,
	} from "#lib/ui/panel-width.ts";
	import RepeatDialog from "#lib/ui/RepeatDialog.svelte";
	import RestoreDialog from "#lib/ui/RestoreDialog.svelte";
	import SaveDialog from "#lib/ui/SaveDialog.svelte";
	import SnapMenu, { type FrameControls } from "#lib/ui/SnapMenu.svelte";
	import UnsavedPlanDialog from "#lib/ui/UnsavedPlanDialog.svelte";
	import { resolve } from "$app/paths";

	interface Props {
		config: EditorConfig;
	}

	let { config }: Props = $props();

	// The configuration is read once: it doesn't change while the editor runs.
	const { session, editor, websiteUrl } = untrack(() => {
		const websiteUrl = config.oauth_url ?? config.osm_api_url;
		const session = new Session({
			oauthUrl: websiteUrl,
			apiUrl: config.osm_api_url,
			clientId: config.oauth_client_id,
			redirectUri: new URL(resolve("/auth/callback"), location.href).href,
		});
		const api = new OsmApi({
			baseUrl: config.osm_api_url,
			getToken: () => session.token(),
			createdBy: `IndoorID ${__GIT_HASH__}`,
		});
		const recentUploads = new RecentUploads();
		const editor = new Editor({
			api,
			minZoom: config.data_min_zoom,
			// The viewer lays them over Overpass answers until Overpass catches up.
			onupload: (changes) => recentUploads.record(changes),
			catalog: {
				services: {
					taginfo: new Taginfo({ baseUrl: config.taginfo_url }),
					wikibase: new OsmWikibase({ baseUrl: config.osm_wiki_api_url }),
					wikidata: new Wikidata({ baseUrl: config.wikidata_api_url }),
					searchWikipedia: (lang, query) =>
						searchWikipedia(lang, query, {
							template: config.wikipedia_api_url,
						}),
				},
			},
		});
		return { session, editor, websiteUrl };
	});
	setEditor(editor);

	/** Snapping, angle step and units (C.1), kept in this browser. */
	const precision = setPrecision(
		new PrecisionSettings(
			(() => {
				try {
					return localStorage;
				} catch {
					return undefined;
				}
			})(),
			navigator.language,
		),
	);
	/** What the pointer snapped to and the lengths shown while drawing or dragging. */
	let feedback = $state.raw<Feedback | null>(null);
	const showFeedback = (shown: Feedback | null) => (feedback = shown);
	/** Sides and corners armed by resting the pointer on them while drawing (C.4). */
	const inferences = new Inferences();

	/** The drawing frame at a position: its level outline's or building's, else north. */
	function frameAt(loc: Loc): Frame {
		return (
			frames.at([...editor.features.byId.values()], loc, level)?.frame ??
			northFrame(loc)
		);
	}

	// Edits are saved in this browser as they are made, and offered back on start.
	const autosave = new EditAutosave(editor, new Autosave());
	$effect(() => {
		void autosave.start();
		return () => autosave.stop();
	});
	$effect(() => {
		void editor.history.graph;
		void editor.sync.failedChangeset;
		autosave.changed();
	});
	let saving = $state(false);
	// Plans saved in earlier visits come back once their images are decoded.
	/**
	 * Floor plan mode: the map only shows building outlines to place plans against, and OSM
	 * features can't be selected or edited.
	 */
	let planMode = $state(false);

	function setPlanMode(on: boolean) {
		planMode = on;
		drawing = null;
		if (on) editor.select(null);
		// Locks the plan in Edit: callers ask first about unsaved changes (closePlanMode).
		else floorplans.cancel();
	}

	/** Leaves floor plan mode, once unsaved changes to the plan in Edit are saved or dropped. */
	function closePlanMode() {
		floorplans.whenSaved(() => setPlanMode(false));
	}

	/** The plan worker, started the first time a plan is imported or loaded. */
	const codec = workerCodec();
	const decoders = planDecoders(codec);
	const planStore = new IndexedDbPlanStore();
	const floorplans = new FloorPlans({ store: planStore, codec });
	void floorplans.restore();
	/** Drawing frames set per building (C.3), kept with the floor plans. */
	const frames = new Frames(planStore);
	void frames.load();
	/** Construction guides placed with the measure tool (C.5), kept with the floor plans. */
	const construction = new Guides(planStore);
	void construction.load();

	/** The snapping menu is open: the frame in view is worked out for it. */
	let snapMenuOpen = $state(false);
	/** Setting the frame on the map: aligning it to a side, or moving its origin. */
	let framePick = $state<FramePick | null>(null);

	/**
	 * The frame of the building in the middle of the map, or of the selected feature's (C.3),
	 * while the grid or the snapping menu needs it.
	 */
	const viewFrame = $derived.by((): BuildingFrame | null => {
		if (!camera || !(precision.grid || snapMenuOpen || framePick)) return null;
		const selected = editor.selection.single;
		const extent = selected ? entityExtent(editor.graph, selected) : null;
		const at: Loc = extent
			? [(extent.west + extent.east) / 2, (extent.south + extent.north) / 2]
			: [camera.lon, camera.lat];
		void frames.version;
		return untrack(() =>
			frames.at([...editor.features.byId.values()], at, level),
		);
	});
	/** The grid's frame: the building's, else north from a round spot near the middle. */
	const gridFrame = $derived.by((): Frame | null => {
		if (!camera || !precision.grid) return null;
		if (viewFrame) return viewFrame.frame;
		const round = (v: number) => Math.round(v * 1000) / 1000;
		return northFrame([round(camera.lon), round(camera.lat)]);
	});
	/** Pixels per metre on the ground at the middle of the map. */
	function pixelsPerMetre(): number {
		if (!map || !camera) return 0;
		const centre: Loc = [camera.lon, camera.lat];
		const a = projectLoc(centre);
		const b = projectLoc(fromLocal(centre, [1, 0]));
		return Math.hypot(b.x - a.x, b.y - a.y);
	}
	/** The grid's spacing for snapping now, or undefined when the grid isn't shown or snapped to. */
	function gridSnap(): { frame: Frame; step: number } | undefined {
		if (!gridFrame || !precision.snaps("grid")) return undefined;
		const step = drawnSpacing(
			{ minor: precision.gridMinor, major: precision.gridMajor },
			pixelsPerMetre(),
		);
		return step ? { frame: gridFrame, step } : undefined;
	}

	/** What the snapping menu shows of the frame, and does to it. */
	const frameControls = $derived<FrameControls>({
		current: viewFrame,
		plans: snapMenuOpen
			? floorplans.plans
					.filter(
						(plan) => plan.visible !== false && isPlanOnLevel(plan, level),
					)
					.map((plan) => {
						const [a, b] = corners(
							plan.transform,
							plan.size.width,
							plan.size.height,
						);
						return { name: plan.name, angle: foldAngle(bearingOf(a, b)) };
					})
			: [],
		onangle: (angle) => {
			if (viewFrame) frames.set(viewFrame.id, { angle: foldAngle(angle) });
		},
		onreset: () => {
			if (viewFrame) frames.reset(viewFrame.id);
		},
		onpick: (pick) => (framePick = pick),
		onturn: () => map?.easeTo({ bearing: -(viewFrame?.frame.angle ?? 0) }),
		onnorth: () => map?.easeTo({ bearing: 0 }),
	});
	/** The side panel's width, as the user left it, kept within the window. */
	let panelWidth = $state(rememberedWidth(localStorage));
	const panelBounds = $derived(widthBounds(innerWidth.current ?? 1280));
	const shownPanelWidth = $derived(clampWidth(panelWidth, panelBounds));
	function keepPanelWidth(width: number) {
		panelWidth = width;
		rememberWidth(localStorage, width);
	}
	let map = $state.raw<MapLibreMap>();
	let camera = $state.raw<Omit<View, "level">>();
	let level = $state(parseHash(location.hash)?.level ?? 0);
	/** The indoor layers, which `MapShell` puts on the map. */
	let indoor = $state.raw<IndoorMap>();
	let background: Imagery | null = null;
	/** Imagery shown since the last upload, for the changeset's imagery_used tag. */
	let imageryUsed = $state<string[]>([]);

	/** Whether floor plans were shown since the last upload: custom imagery in the changeset. */
	let floorPlansUsed = $state(false);
	$effect(() => {
		if (floorplans.plans.some((p) => p.visible && isPlanOnLevel(p, level))) {
			floorPlansUsed = true;
		}
	});

	/** After an upload, only what is shown now counts for the next changeset. */
	function uploaded() {
		imageryUsed = background ? [background.name] : [];
		floorPlansUsed = floorplans.plans.some(
			(p) => p.visible && isPlanOnLevel(p, level),
		);
	}

	function backgroundPicked(entry: Imagery | null) {
		background = entry;
		if (entry && !imageryUsed.includes(entry.name)) {
			imageryUsed = [...imageryUsed, entry.name];
		}
	}

	/** The drawing tool on (P5.3.4; the split tool, P5.3.5), or null when browsing. */
	let drawing = $state<
		"point" | "line" | "area" | "rectangle" | "split" | "measure" | null
	>(null);
	/** How the rectangle tool draws (Tab switches). */
	let rectangleVariant = $state<RectangleVariant>("corners");
	/** Whether the measure tool measures or places guides (Tab switches). */
	let measureVariant = $state<MeasureVariant>("measure");
	/** The split tool's cut line, or the lasso, as drawn so far. */
	let cut = $state.raw<readonly Loc[]>([]);

	/** Turns a drawing tool on, or off when it is on already. */
	function draw(
		kind: "point" | "line" | "area" | "rectangle" | "split" | "measure",
	) {
		drawing = drawing === kind ? null : kind;
		rectangleVariant = "corners";
		measureVariant = "measure";
		if (drawing) editor.select(null);
	}

	/** A drawing ended: back to browsing, the new feature selected for its type to be picked. */
	function drawingEnded(id: EntityId | null) {
		drawing = null;
		if (id) editor.select(id);
	}

	const DRAW_HINTS = {
		point: msg("draw_point_hint"),
		line: msg("draw_line_hint"),
		area: msg("draw_area_hint"),
		rectangle: msg("draw_rectangle_hint"),
		split: msg("split_hint"),
		measure: msg("measure_hint"),
	};

	/** Cuts the rooms, corridors and areas on the shown level the line crosses, in one step. */
	function split(line: readonly Loc[] | null) {
		drawing = null;
		const extent = line && extentOf(line);
		if (!line || !extent) return;
		const candidates = [
			...new Set(editor.features.segmentsNear(extent, level).map((s) => s.way)),
		];
		const targets = splitTargets(editor.graph, line, candidates);
		if (targets.length === 0) {
			showNote(msg("split_nothing"));
			return;
		}
		editor.history.perform(splitAreas(line, targets), msg("undo_split"));
		editor.select(null);
	}

	/** Adds what a lasso holds, on the shown level, to the selection (P5.3.6). */
	function selectInLasso(lasso: readonly Loc[]) {
		const extent = extentOf(lasso);
		if (!extent) return;
		const found = featuresInLasso(
			editor.graph,
			lasso,
			editor.features.nodesNear(extent, level),
		);
		if (found.length > 0) editor.select([...editor.selection.ids, ...found]);
	}

	/** The feature Repeat on levels is asking about, while its dialog is open. */
	let repeating = $state<NodeId | WayId | null>(null);

	/** The drawn nodes on a level around the feature being repeated. */
	function nodesAround(id: EntityId) {
		return (onLevel: number) => {
			const extent = entityExtent(editor.graph, id);
			return extent ? editor.features.nodesNear(extent, onLevel) : [];
		};
	}

	/** What Copy kept, for Paste. */
	let clipboard = $state.raw<Clipboard | null>(null);
	/** Where the pointer last was on the map while browsing, where a paste goes. */
	let lastPointer: LngLat | null = null;
	/** Why the last operation asked for couldn't run, or what it did, shown for a moment. */
	let operationNote = $state.raw<Message | null>(null);
	let noteTimer: ReturnType<typeof setTimeout> | undefined;

	function showNote(note: Message) {
		operationNote = note;
		clearTimeout(noteTimer);
		noteTimer = setTimeout(() => (operationNote = null), 3000);
	}

	function operationContext(): OperationContext {
		const center = map?.getCenter();
		return {
			graph: editor.graph,
			selected: editor.selection.ids,
			level,
			pasteAt: lastPointer ?? (center ? [center.lng, center.lat] : [0, 0]),
			clipboard,
		};
	}

	/** The operations on the selection (P5.3.5), while browsing. */
	const operations = $derived.by(() => {
		if (modeKind !== "browse" || editor.history.locked) return [];
		const context = operationContext();
		return OPERATIONS.filter((o) => o.available(context)).map((operation) => ({
			operation,
			disabled: operation.disabled(context),
		}));
	});

	function runOperation(operation: Operation) {
		const context = operationContext();
		const reason = operation.disabled(context);
		if (reason) {
			showNote(reason);
			return;
		}
		const result = operation.run(context);
		if (result.kind === "repeat") {
			repeating = result.id;
			return;
		}
		if (result.kind === "copy") {
			clipboard = result.clipboard;
			const count = result.clipboard.roots.length;
			const paste = formatCombo("Mod+V", mac);
			showNote(
				count > 1
					? msg("operation_copied_many", { count, paste })
					: msg("operation_copied", { paste }),
			);
		} else performEdit(editor, result);
	}

	const OPERATION_ICONS: Record<Operation["id"], Component> = {
		copy: Copy,
		repeat: Layers2,
		paste: ClipboardPaste,
		disconnect: Unlink,
		square: Square,
		merge: Combine,
		multipolygon: SquaresSubtract,
		delete: Trash,
	};

	/** What the map's clicks, drags and keys do now (see `edit/modes`). */
	const modeKind = $derived(
		planMode
			? floorplans.tool
				? "floorplan-tool"
				: "floorplan"
			: framePick
				? `frame-${framePick}`
				: drawing
					? `draw-${drawing}`
					: "browse",
	);
	let modes = $state.raw<ModeManager>();

	// Floor plans and editing modes live as long as the map and its indoor layers.
	$effect(() => {
		const instance = map;
		const indoorLayers = indoor;
		if (!instance || !indoorLayers) return;
		$effect(() => indoorLayers.setPlanMode(planMode));
		$effect(() =>
			indoorLayers.setBuildingsVisible(floorplans.buildings.visible),
		);
		const overlay = new EditOverlay(instance);
		const guides = new GuideLayer(instance);
		$effect(() => guides.show(feedback));
		const constructionLayer = new ConstructionLayer(instance);
		$effect(() =>
			constructionLayer.setGuides(planMode ? [] : construction.on(level)),
		);
		const grid = new GridLayer(instance);
		$effect(() => {
			void camera;
			const frame = planMode ? null : gridFrame;
			if (!frame) {
				grid.setLines([]);
				return;
			}
			const { clientWidth: w, clientHeight: h } = instance.getContainer();
			const view = [
				{ x: 0, y: 0 },
				{ x: w, y: 0 },
				{ x: w, y: h },
				{ x: 0, y: h },
			].map(unprojectPoint);
			grid.setLines(
				gridLines(
					frame,
					view,
					{ minor: precision.gridMinor, major: precision.gridMajor },
					untrack(pixelsPerMetre),
				),
			);
		});
		$effect(() =>
			overlay.setData(
				planMode
					? { type: "FeatureCollection", features: [] }
					: {
							type: "FeatureCollection",
							features: [
								...overlayFeatures(editor.graph, {
									selected: editor.selection.ids,
									hover: editor.selection.hover,
									zoom: camera?.zoom ?? 0,
									nodesInView: () => {
										const extent = visibleExtent();
										return extent
											? editor.features.nodesNear(extent, level)
											: [];
									},
								}).features,
								...floorFeature(editor.floor?.rings),
								...cutFeature(cut),
							],
						},
			),
		);
		/** What a press at a screen point drags: an overlay vertex or midpoint, the selected point. */
		const grabAt = (point: { x: number; y: number }): NodeGrab | null => {
			if (editor.history.locked) return null;
			const grab = overlay.grabAt(point);
			if (grab) return grab;
			const id = editor.selection.single;
			const selected = id ? editor.graph.entity(id) : undefined;
			return selected?.type === "node" &&
				editor.graph.parentWays(selected.id).length === 0 &&
				indoorLayers.hitTest(point) === selected.id
				? { kind: "vertex", id: selected.id }
				: null;
		};

		/** Whether a selected feature is drawn at a screen point (a press there moves it). */
		const selectedAt = (point: { x: number; y: number }): boolean => {
			if (editor.history.locked) return false;
			const hit = indoorLayers.hitTest(point);
			return hit !== null && editor.selection.has(hit as EntityId);
		};

		/**
		 * A click on a level outline's or building's floor (not on its outline) or on the empty
		 * map selects the unmapped floor there, when there is some (P5.4a).
		 */
		const selectFloorAt = (at: MapPoint, hit: string | null): boolean => {
			if (hit !== null) {
				const tags = editor.features.byId.get(hit)?.properties;
				const container =
					tags?.indoor === "level" ||
					(tags?.indoor === undefined &&
						tags?.building !== undefined &&
						tags.building !== "no");
				if (!container || indoorLayers.outlineAt(at.point) === hit)
					return false;
			}
			const found = unmappedFloorAt(
				editor.features.byId.values(),
				at.lngLat,
				level,
			);
			if (!found) return false;
			editor.selectFloor(found);
			return true;
		};

		const layers = new FloorPlanLayers(instance, floorplans.tiles);
		const stopTiles = layers.onTiles((count) => (planTiles = count));
		const marks = new PlanToolLayer(instance);
		$effect(() => layers.setLayers(floorplans.layers));
		// A copy: reading every entry follows content added or dropped.
		$effect(() => layers.setContents(new Map(floorplans.contents)));
		$effect(() => layers.setLevel(level));
		// Plan content is kept for the level shown (and the plan in Edit) only.
		$effect(() => floorplans.showLevel(level));
		// Frames tell the plans apart in floor plan mode; tool marks show whenever a tool is on.
		$effect(() => {
			const frames = planMode
				? planFrames(floorplans.plans, level).features
				: [];
			const tools = toolFeatures(
				floorplans.editing,
				floorplans.tool,
				planMode,
				pointer,
			).features;
			marks.setData({
				type: "FeatureCollection",
				features: [...frames, ...tools],
			});
		});

		const manager = new ModeManager(instance);
		modes = manager;
		$effect(() => {
			// Only the kind decides: a mode reads the graph and level as they are when it starts.
			const kind = modeKind;
			untrack(() => {
				switch (kind) {
					case "browse":
						manager.setMode(
							browseMode({
								hitTest: (point) => indoorLayers.hitTest(point),
								select: (id) => editor.select(id as EntityId | null),
								toggle: (id) => editor.selection.toggle(id as EntityId),
								move: (at) =>
									selectedAt(at.point)
										? featureDrag(editor.selection.ids, at, editor.history, {
												onhint: (hint) => (dragHint = hint),
											})
										: null,
								lasso: (at) =>
									lassoDrag(at.lngLat, {
										onchange: (line) => (cut = line),
										onend: selectInLasso,
									}),
								pointer: (at) => (lastPointer = at?.lngLat ?? null),
								floor: selectFloorAt,
								hover: (id) => editor.selection.setHover(id as EntityId | null),
								draggable: (point) =>
									grabAt(point) !== null || selectedAt(point),
								vertexAt: (point) => {
									const grab = overlay.grabAt(point);
									return grab?.kind === "vertex" ? grab.id : null;
								},
								drag: (at) => {
									const grab = grabAt(at.point);
									return (
										grab &&
										nodeDrag(grab, {
											history: editor.history,
											snap: snapNode,
											onhint: (hint) => (dragHint = hint),
											show: showFeedback,
										})
									);
								},
							}),
						);
						break;
					case "draw-point":
						manager.setMode(
							drawPointMode({
								history: editor.history,
								level,
								snap: snapNode,
								onfinish: drawingEnded,
							}),
						);
						break;
					case "draw-line":
					case "draw-area":
						manager.setMode(
							drawWayMode(kind === "draw-line" ? "line" : "area", {
								history: editor.history,
								level,
								snap: snapNode,
								onfinish: drawingEnded,
								precision: {
									frameAt,
									step: () => precision.step,
									units: () => precision.units,
									show: showFeedback,
									inferences,
								},
							}),
						);
						break;
					case "draw-measure":
						manager.setMode(
							measureMode({
								snap: snapNode,
								variant: measureVariant,
								onvariant: (variant) => (measureVariant = variant),
								onguide: (line) =>
									construction.add(
										line,
										level,
										frames.at(
											[...editor.features.byId.values()],
											line.origin,
											level,
										)?.id,
									),
								onexit: () => (drawing = null),
								precision: {
									frameAt,
									step: () => precision.step,
									units: () => precision.units,
									show: showFeedback,
								},
							}),
						);
						break;
					case "draw-rectangle":
						manager.setMode(
							drawRectangleMode({
								history: editor.history,
								level,
								snap: snapNode,
								onfinish: drawingEnded,
								onvariant: (variant) => (rectangleVariant = variant),
								precision: {
									frameAt,
									step: () => precision.step,
									units: () => precision.units,
									show: showFeedback,
								},
							}),
						);
						break;
					case "frame-align":
					case "frame-origin":
						manager.setMode(
							framePickMode({
								pick: kind === "frame-align" ? "align" : "origin",
								snap: (at) =>
									kind === "frame-align" ? sideAt(at) : snapNode(at, new Set()),
								onangle: (angle) => {
									if (viewFrame) frames.set(viewFrame.id, { angle });
								},
								onorigin: (origin) => {
									if (viewFrame)
										frames.set(viewFrame.id, {
											angle: viewFrame.frame.angle,
											origin: [origin[0], origin[1]],
										});
								},
								ondone: () => (framePick = null),
							}),
						);
						break;
					case "draw-split":
						manager.setMode(
							splitMode({
								snap: (at) => {
									const target = snapNode(at, new Set());
									return target ? target.loc : null;
								},
								onchange: (line) => (cut = line),
								onfinish: split,
							}),
						);
						break;
					case "floorplan":
						manager.setMode(
							floorPlanMode({
								map: instance,
								floorplans,
								close: closePlanMode,
							}),
						);
						break;
					case "floorplan-tool":
						manager.setMode(
							floorPlanToolMode({
								floorplans,
								snap,
								onmessage: (message) => (toolMessage = message),
								onpointer: (at) => (pointer = at),
							}),
						);
						break;
				}
			});
		});
		return () => {
			modes = undefined;
			manager.remove();
			stopTiles();
			overlay.remove();
			guides.remove();
			grid.remove();
			constructionLayer.remove();
			marks.remove();
			layers.remove();
		};
	});

	// A drawing ends when the shown level changes, as with Escape: its corners snapped to the
	// level it started on, and it is tagged with that level.
	$effect(() => {
		void level;
		untrack(() => modes?.finish());
	});

	// The unmapped floor selected follows the edits made around it (an undo, a room drawn
	// into it) and goes when the level changes or nothing of it is left.
	$effect(() => {
		const { byId } = editor.features;
		const shown = level;
		untrack(() => {
			const floor = editor.floor;
			if (!floor) return;
			editor.floor =
				floor.level === shown
					? unmappedFloorAt(byId.values(), floor.at, shown)
					: null;
		});
	});

	/** Message from the alignment tool about the last click. */
	let toolMessage = $state.raw<Message | null>(null);
	/** Where the pointer is on the map, while the measure line follows it. */
	let pointer = $state.raw<LngLat | null>(null);

	/**
	 * A clicked position, moved onto what is within 8 px of it on the shown level. A click on
	 * the plan in Edit (a control point's spot on the plan, a measured spot, the spot to turn
	 * around) snaps to the plan's own corners and line ends; a click on the map (where a control
	 * point really is) to the nearest OSM node, else to the corners of the other plans shown:
	 * control points then sit exactly on drawn walls and corners.
	 */
	function snap(point: { x: number; y: number }, lngLat: LngLatLike): LngLat {
		const { lng, lat } = LngLatClass.convert(lngLat);
		const clicked: LngLat = [lng, lat];
		if (!map) return clicked;
		const area = areaAround(point, unprojectPoint);
		const editing = floorplans.editing?.id;
		const tool = floorplans.tool;
		const target = snapAt(
			point,
			tool?.kind === "points" && tool.pending
				? {
						nodes: editor.features.nodesNear(area, level),
						// A building's corners and walls: the sides of what is drawn.
						segments: editor.features.segmentsNear(area, level),
						planVertices: floorplans.verticesNear(
							area,
							level,
							(p) => p.id !== editing,
						),
					}
				: {
						planVertices: floorplans.verticesNear(
							area,
							level,
							(p) => p.id === editing,
						),
					},
			projectLoc,
		);
		return target ? [target.loc[0], target.loc[1]] : clicked;
	}

	/**
	 * Where a dragged node or a drawn corner snaps (P5.3.2, C.1): onto a node, a side's
	 * midpoint, a side of a way, or a floor plan's vertex within 8 px on the shown level,
	 * leaving out the nodes dragged and their sides; then onto the drawing's direction lines,
	 * alone or where they cross sides. Each kind as the snapping menu says; Alt held: nowhere.
	 */
	function snapNode(
		at: MapPoint,
		exclude: ReadonlySet<NodeId>,
		keepSide: (side: Segment) => boolean = () => true,
		constraints: SnapConstraints = {},
	): SnapTarget | null {
		if (!map || at.altKey) return null;
		const points = precision.snaps("points");
		const lines = constraints.lines?.filter((line) =>
			precision.snaps(line.kind ? INFERENCE_OPTIONS[line.kind] : "angles"),
		);
		const reach = lines?.length ? LINE_PIXELS : undefined;
		const area = areaAround(at.point, unprojectPoint, reach);
		const segments =
			points || precision.snaps("midpoints") || lines?.length
				? editor.features
						.segmentsNear(area, level)
						.filter(
							(s) =>
								!exclude.has(s.a.id) && !exclude.has(s.b.id) && keepSide(s),
						)
				: [];
		return snapAt(
			at.point,
			{
				nodes: points
					? editor.features
							.nodesNear(area, level)
							.filter((n) => !exclude.has(n.id))
					: [],
				// Sides for lines to cross even when points don't snap.
				segments: points ? segments : [],
				planVertices: precision.snaps("planVertices")
					? floorplans.verticesNear(area, level)
					: [],
				midpoints: precision.snaps("midpoints"),
				lines,
				lock: constraints.lock,
				grid: gridSnap(),
				from: precision.snaps("parallels") ? constraints.from : undefined,
				guides: points ? construction.on(level) : [],
				crossings: precision.snaps("intersections"),
			},
			projectLoc,
			undefined,
			at.lngLat,
		);
	}

	/** The side under the pointer, for aligning the frame to it. */
	function sideAt(at: MapPoint): SnapTarget | null {
		if (!map) return null;
		const area = areaAround(at.point, unprojectPoint);
		return snapAt(
			at.point,
			{ segments: editor.features.segmentsNear(area, level) },
			projectLoc,
		);
	}

	const projectLoc = (loc: Loc) => project_(map, loc);
	const unprojectPoint = (point: { x: number; y: number }) =>
		unproject_(map, point);

	/** What the node being dragged moves with it (shared vertices), while dragging. */
	let dragHint = $state.raw<Message | null>(null);

	/** The map in view, as an extent. */
	const visibleExtent = () => extentOfView(map);

	/** The levels of the data in view, named, for the switcher and Repeat on levels. */
	const levelsInView = $derived.by(() => {
		const extent = camera && visibleExtent();
		return extent ? editor.features.levelsIn(extent) : [];
	});

	/** Fits a feature in the part of the map the side panel leaves visible. */
	function zoomTo(id: EntityId) {
		const extent = entityExtent(editor.graph, id);
		if (!map || !extent) return;
		map.fitBounds(
			[
				[extent.west, extent.south],
				[extent.east, extent.north],
			],
			{
				padding: {
					top: 60,
					bottom: 60,
					right: 60,
					left: (sidePanel?.offsetWidth ?? 0) + 60,
				},
				maxZoom: 20,
			},
		);
	}

	/** Selects a feature, zooming to it when none of it is in view (a relation's member, as iD). */
	function show(id: EntityId) {
		editor.select(id);
		const extent = entityExtent(editor.graph, id);
		const view = visibleExtent();
		if (extent && view && !extentsIntersect(extent, view)) zoomTo(id);
	}

	/** Floor plan tiles the map draws (for the e2e tests' `data-plan-tiles`). */
	let planTiles = $state<number>();

	/** The selected features when there are several (P5.3.6), edited together. */
	const several = $derived.by(() => {
		if (editor.selection.ids.length < 2) return null;
		const entities = editor.selection.ids.flatMap((id) => {
			const entity = editor.graph.entity(id);
			return entity ? [entity] : [];
		});
		return entities.length > 1 ? entities : null;
	});
	const panelOpen = $derived(
		editor.selected !== null ||
			several !== null ||
			editor.floor !== null ||
			planMode,
	);

	/** The side panel, which covers the left of the map while it is open. */
	let sidePanel = $state<HTMLElement>();

	/** The buildings under the plan in Edit, which it can be assigned to. */
	const planBuildings = $derived.by(() => {
		const plan = floorplans.editing;
		if (!plan) return [];
		const { width, height } = plan.size;
		const ring = corners(plan.transform, width, height);
		const extent = {
			west: Math.min(...ring.map((c) => c[0])),
			south: Math.min(...ring.map((c) => c[1])),
			east: Math.max(...ring.map((c) => c[0])),
			north: Math.max(...ring.map((c) => c[1])),
		};
		return buildingsUnder(
			editor.graph,
			editor.features.segmentsNear(extent, level).map((s) => s.way),
			project(plan.transform, [width / 2, height / 2]),
		);
	});

	function planBuildingName(id: string): string | undefined {
		const entity = editor.graph.entity(id as EntityId);
		return entity && buildingName(entity.tags, id);
	}

	/** The part of the map the side panel leaves visible, for placing new floor plans. */
	function planView(): PlanView | undefined {
		if (!map) return undefined;
		const { clientWidth, clientHeight } = map.getContainer();
		const left = sidePanel?.offsetWidth ?? 0;
		const { lng, lat } = map.unproject([
			(left + clientWidth) / 2,
			clientHeight / 2,
		]);
		const bounds = map.getBounds();
		return {
			center: [lng, lat],
			heightMetres: groundDistance(
				[lng, bounds.getNorth()],
				[lng, bounds.getSouth()],
			),
		};
	}

	const mac = isMac();
	/** Shortcuts that apply in every mode but floor plan mode (OSM edits can't be seen there). */
	const SHORTCUTS = [
		{ combo: "1", run: () => draw("point") },
		{ combo: "2", run: () => draw("line") },
		{ combo: "3", run: () => draw("area") },
		{ combo: "4", run: () => draw("rectangle") },
		{ combo: "X", run: () => draw("split") },
		{ combo: "S", run: () => precision.toggle() },
		{ combo: "G", run: () => precision.toggleGrid() },
		{ combo: "M", run: () => draw("measure") },
		{ combo: "Mod+Z", run: () => editor.history.undo() },
		{ combo: "Mod+Shift+Z", run: () => editor.history.redo() },
		{ combo: "Mod+Y", run: () => editor.history.redo() },
	];

	/** The map's keys: the mode's first (Escape…), then undo and redo; none while typing. */
	function onKeydown(event: KeyboardEvent) {
		// Popovers and dialogs handle their own keys (Escape closes them); fields have their own
		// undo.
		if (floorplans.confirming) return;
		const shortcut = SHORTCUTS.find((s) => matches(event, s.combo, mac));
		if (!isForMap(event)) {
			// Behind a dialog, the browser's own undo would still undo typing in a field.
			if (shortcut && !event.defaultPrevented && !isTyping(event.target))
				event.preventDefault();
			return;
		}
		if (modes?.key(event)) {
			// Tab, quotes and Enter typed into a drawing (C.2) are not the browser's.
			event.preventDefault();
			return;
		}
		if (planMode) return;
		const operation = operations.find(({ operation }) =>
			operation.keys.some((combo) => matches(event, combo, mac)),
		)?.operation;
		if (operation) {
			event.preventDefault();
			runOperation(operation);
			return;
		}
		if (!shortcut) return;
		event.preventDefault();
		shortcut.run();
	}

	/** Leaving the page loses the edits not uploaded yet: the browser asks first. */
	function onBeforeUnload(event: BeforeUnloadEvent) {
		if (editor.history.editCount > 0 || editor.sync.uploading)
			event.preventDefault();
	}
</script>

<svelte:window onkeydown={onKeydown} onbeforeunload={onBeforeUnload} />
<svelte:document
	onvisibilitychange={() => {
		if (document.visibilityState === "hidden") void autosave.flush();
	}}
/>

{#snippet iconButton(
	label: string,
	hint: string,
	Icon: Component,
	disabled: boolean,
	onclick: () => void,
)}
	<Tooltip.Root>
		<Tooltip.Trigger {disabled} {onclick}>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="outline"
					size="icon"
					aria-label={label}
					{disabled}
				>
					<Icon />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="bottom">{hint}</Tooltip.Content>
	</Tooltip.Root>
{/snippet}

{#snippet drawButton(
	kind: "point" | "line" | "area" | "rectangle" | "split" | "measure",
	label: string,
	key: string,
	Icon: Component,
)}
	<Tooltip.Root>
		<Tooltip.Trigger onclick={() => draw(kind)}>
			{#snippet child({ props })}
				<Button
					{...props}
					variant={drawing === kind ? "secondary" : "outline"}
					size="icon"
					aria-label={kind === "split"
						? "Split rooms"
						: kind === "measure"
							? "Measure"
							: `Draw ${label.toLowerCase()}`}
					aria-pressed={drawing === kind}
					disabled={editor.history.locked}
				>
					<Icon />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="bottom">{label} ({key})</Tooltip.Content>
	</Tooltip.Root>
{/snippet}

{#snippet operationButton(operation: Operation, disabled: Message | null)}
	{@const Icon = OPERATION_ICONS[operation.id]}
	{@const label = t(operation.label)}
	<Tooltip.Root>
		<Tooltip.Trigger onclick={() => runOperation(operation)}>
			{#snippet child({ props })}
				<!-- aria-disabled, not disabled: the tooltip still says why. -->
				<Button
					{...props}
					variant="outline"
					size="icon"
					aria-label={label}
					aria-disabled={disabled !== null}
					class={disabled ? "opacity-50" : ""}
				>
					<Icon />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="bottom">
			{label}
			({formatCombo(operation.keys[0] ?? "", mac)}){disabled
				? `: ${t(disabled)}`
				: ""}
		</Tooltip.Content>
	</Tooltip.Root>
{/snippet}

<MapShell
	{config}
	bind:level
	bind:map
	bind:camera
	bind:indoor
	left={panelOpen ? shownPanelWidth : 0}
	{planTiles}
	onbackground={backgroundPicked}
>
	{#snippet controls()}
		{#if !planMode}
			<!-- Map controls sit on an opaque surface: shadcn's dark outline styles are translucent. -->
			<div class="rounded-md bg-background shadow-md">
				<ButtonGroup.Root aria-label="Edit history">
					{@render iconButton(
						"Undo",
						`Undo (${formatCombo("Mod+Z", mac)})`,
						Undo2,
						!editor.history.canUndo,
						() => editor.history.undo(),
					)}
					{@render iconButton(
						"Redo",
						`Redo (${formatCombo("Mod+Shift+Z", mac)})`,
						Redo2,
						!editor.history.canRedo,
						() => editor.history.redo(),
					)}
					<!-- Not while a drawing or drag is shown: the upload sends finished steps only. -->
					<Button
						variant="outline"
						disabled={editor.history.editCount === 0 ||
							editor.history.previewing}
						onclick={() => (saving = true)}
					>
						<Upload data-icon="inline-start" />
						Save
						<Badge class="tabular-nums" data-testid="edit-count"
							>{editor.history.editCount}</Badge
						>
						<span class="sr-only">edits</span>
					</Button>
				</ButtonGroup.Root>
			</div>
			<div class="rounded-md bg-background shadow-md">
				<ButtonGroup.Root aria-label="Draw">
					{@render drawButton("point", "Point", "1", MapPin)}
					{@render drawButton("line", "Line", "2", Spline)}
					{@render drawButton("area", "Area", "3", Pentagon)}
					{@render drawButton(
						"rectangle",
						"Rectangle",
						"4",
						RectangleHorizontal,
					)}
					{@render drawButton("split", "Split", "X", Scissors)}
					{@render drawButton("measure", "Measure", "M", Ruler)}
				</ButtonGroup.Root>
			</div>
			<div class="rounded-md bg-background shadow-md">
				<SnapMenu
					{precision}
					frame={frameControls}
					guides={{
						count: construction.countOn(level),
						shown: construction.shown,
						onshow: (shown) => (construction.shown = shown),
						onclear: () => construction.clear(level),
					}}
					onopenchange={(open) => (snapMenuOpen = open)}
				/>
			</div>
			{#if operations.length > 0}
				<div class="rounded-md bg-background shadow-md">
					<ButtonGroup.Root aria-label="Edit selection">
						{#each operations as { operation, disabled } (operation.id)}
							{@render operationButton(operation, disabled)}
						{/each}
					</ButtonGroup.Root>
				</div>
			{/if}
		{/if}
	{/snippet}
	{#snippet tools()}
		<div class="rounded-md bg-background shadow-md">
			<Button
				variant={planMode ? "secondary" : "outline"}
				aria-pressed={planMode}
				onclick={() => (planMode ? closePlanMode() : setPlanMode(true))}
			>
				<FileImage data-icon="inline-start" />
				Floor plans
			</Button>
		</div>
	{/snippet}

	<!-- The side panel edits the selected feature, or the floor plans in floor plan mode. -->
	{#if panelOpen}
		<div
			bind:this={sidePanel}
			class="absolute inset-y-0 left-0 z-30"
			style:width="{shownPanelWidth}px"
		>
			{#if editor.selected}
				{#key editor.selection.ids.join(",")}
					<Inspector
						entity={editor.selected}
						{websiteUrl}
						viewExtent={visibleExtent}
						onzoom={zoomTo}
						onshow={show}
						{level}
					/>
				{/key}
			{:else if several}
				{#key several.map((e) => e.id).join(",")}
					<MultiInspector entities={several} />
				{/key}
			{:else if editor.floor}
				<FloorPanel floor={editor.floor} />
			{:else}
				<FloorPlansPanel
					{floorplans}
					{decoders}
					getView={planView}
					{level}
					{toolMessage}
					onclose={closePlanMode}
					onshowlevel={(shown) => (level = shown)}
					buildings={planBuildings}
					buildingName={planBuildingName}
					guides={construction}
				/>
			{/if}
			<PanelResizer
				width={shownPanelWidth}
				bounds={panelBounds}
				label="Resize the side panel"
				onresize={(width) => (panelWidth = width)}
				oncommit={keepPanelWidth}
			/>
		</div>
	{/if}

	{#if feedback && (feedback.measures.length > 0 || feedback.input)}
		<MeasureLabels
			measures={feedback.measures}
			input={feedback.input}
			inference={inferenceLabel(feedback.snap)}
			project={projectLoc}
			units={precision.units}
			{camera}
		/>
	{/if}

	{#if framePick}
		<p
			role="status"
			data-testid="frame-hint"
			class="absolute bottom-20 left-1/2 z-10 max-w-[90%] -translate-x-1/2 rounded-full bg-popover px-4 py-1.5 text-center text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
		>
			{t(
				framePick === "align"
					? msg("frame_pick_align")
					: msg("frame_pick_origin"),
			)}
		</p>
	{:else if drawing && !dragHint && !operationNote}
		<p
			role="status"
			data-testid="draw-hint"
			class="absolute bottom-20 left-1/2 z-10 max-w-[90%] -translate-x-1/2 rounded-full bg-popover px-4 py-1.5 text-center text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
		>
			{t(
				drawing === "rectangle" && rectangleVariant === "side"
					? msg("draw_rectangle_side_hint")
					: drawing === "measure" && measureVariant === "guide"
						? msg("guide_hint")
						: DRAW_HINTS[drawing],
			)}
		</p>
	{/if}

	{#if operationNote && !dragHint}
		<p
			role="status"
			data-testid="operation-note"
			class="absolute bottom-20 left-1/2 z-10 max-w-[90%] -translate-x-1/2 rounded-full bg-popover px-4 py-1.5 text-center text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
		>
			{t(operationNote)}
		</p>
	{/if}

	{#if dragHint}
		<p
			role="status"
			data-testid="drag-hint"
			class="absolute bottom-20 left-1/2 z-10 -translate-x-1/2 rounded-full bg-popover px-4 py-1.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
		>
			{t(dragHint)}
		</p>
	{/if}

	{#if saving}
		<SaveDialog
			{session}
			imagery={imageryUsed}
			floorPlans={floorPlansUsed}
			onuploaded={uploaded}
			{websiteUrl}
			onclose={() => (saving = false)}
		/>
	{/if}

	<UnsavedPlanDialog {floorplans} />
	<RestoreDialog
		offer={autosave.offer}
		onrestore={() => void autosave.restore()}
		ondiscard={() => void autosave.discard()}
	/>

	{#if repeating}
		<RepeatDialog
			id={repeating}
			{level}
			levels={levelsInView}
			near={nodesAround(repeating)}
			onclose={() => (repeating = null)}
		/>
	{/if}
</MapShell>
