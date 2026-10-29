<script lang="ts">
	import ClipboardPaste from "@lucide/svelte/icons/clipboard-paste";
	import Combine from "@lucide/svelte/icons/combine";
	import Copy from "@lucide/svelte/icons/copy";
	import FileImage from "@lucide/svelte/icons/file-image";
	import Layers2 from "@lucide/svelte/icons/layers-2";
	import MapPin from "@lucide/svelte/icons/map-pin";
	import Pentagon from "@lucide/svelte/icons/pentagon";
	import Redo2 from "@lucide/svelte/icons/redo-2";
	import Scissors from "@lucide/svelte/icons/scissors";
	import Spline from "@lucide/svelte/icons/spline";
	import Square from "@lucide/svelte/icons/square";
	import Trash from "@lucide/svelte/icons/trash";
	import Undo2 from "@lucide/svelte/icons/undo-2";
	import Unlink from "@lucide/svelte/icons/unlink";
	import Upload from "@lucide/svelte/icons/upload";
	import { type Component, untrack } from "svelte";
	import { innerWidth } from "svelte/reactivity/window";
	import type { Clipboard } from "#lib/actions/copy.ts";
	import { splitAreas, splitTargets } from "#lib/actions/split-areas.ts";
	import type { Place } from "#lib/api/nominatim.ts";
	import type { Bbox } from "#lib/api/osm-api.ts";
	import { OsmApi } from "#lib/api/osm-api.ts";
	import { OsmWikibase } from "#lib/api/osm-wikibase.ts";
	import { Taginfo } from "#lib/api/taginfo.ts";
	import { searchWikipedia, Wikidata } from "#lib/api/wikidata.ts";
	import { Badge } from "#lib/components/shadcn/badge/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as ButtonGroup from "#lib/components/shadcn/button-group/index.ts";
	import * as Tooltip from "#lib/components/shadcn/tooltip/index.ts";
	import type { EditorConfig } from "#lib/config.ts";
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
	import { drawPointMode, drawWayMode } from "#lib/edit/modes/draw.ts";
	import {
		floorPlanMode,
		floorPlanToolMode,
	} from "#lib/edit/modes/floorplan.ts";
	import { splitMode } from "#lib/edit/modes/split.ts";
	import { type NodeGrab, nodeDrag } from "#lib/edit/node-drag.ts";
	import {
		OPERATIONS,
		type Operation,
		type OperationContext,
	} from "#lib/edit/operations.ts";
	import { cutFeature, overlayFeatures } from "#lib/edit/overlay.ts";
	import { workerCodec } from "#lib/floorplans/codec.ts";
	import { groundDistance, type LngLat } from "#lib/floorplans/georef.ts";
	import { planDecoders } from "#lib/floorplans/import.ts";
	import { type Message, msg, t } from "#lib/i18n/messages.ts";
	import { setBackground } from "#lib/map/background.ts";
	import { EditOverlay } from "#lib/map/edit-overlay.ts";
	import type { Segment } from "#lib/map/feature-store.ts";
	import {
		FloorPlanLayers,
		PlanToolLayer,
		planFrames,
		toolFeatures,
	} from "#lib/map/floorplan-layers.ts";
	import {
		formatHash,
		parseHash,
		type MapView as View,
	} from "#lib/map/hash.ts";
	import type { ImageryEntry } from "#lib/map/imagery.ts";
	import { IndoorMap } from "#lib/map/indoor-map.ts";
	import {
		LngLat as LngLatClass,
		type LngLatLike,
		type Map as MapLibreMap,
	} from "#lib/map/maplibre.ts";
	import { areaAround, type SnapTarget, snapAt } from "#lib/map/snap.ts";
	import type { EntityId, Loc, NodeId, WayId } from "#lib/osm/entity.ts";
	import {
		type Extent,
		extentOf,
		extentsIntersect,
	} from "#lib/osm/geometry.ts";
	import { entityExtent } from "#lib/osm/relations.ts";
	import { IndexedDbPlanStore } from "#lib/persist/plan-store.ts";
	import { performEdit } from "#lib/state/commands.ts";
	import { Editor, setEditor } from "#lib/state/editor.svelte.ts";
	import {
		FloorPlans,
		isPlanOnLevel,
		type View as PlanView,
	} from "#lib/state/floorplans.svelte.ts";
	import { Session } from "#lib/state/session.svelte.ts";
	import FloorPlansPanel from "#lib/ui/FloorPlansPanel.svelte";
	import ImageryPicker from "#lib/ui/ImageryPicker.svelte";
	import Inspector from "#lib/ui/Inspector.svelte";
	import LevelControl from "#lib/ui/LevelControl.svelte";
	import MapView from "#lib/ui/MapView.svelte";
	import MultiInspector from "#lib/ui/MultiInspector.svelte";
	import PanelResizer from "#lib/ui/PanelResizer.svelte";
	import {
		clampWidth,
		rememberedWidth,
		rememberWidth,
		widthBounds,
	} from "#lib/ui/panel-width.ts";
	import RepeatDialog from "#lib/ui/RepeatDialog.svelte";
	import SaveDialog from "#lib/ui/SaveDialog.svelte";
	import SearchPlace from "#lib/ui/SearchPlace.svelte";
	import UnsavedPlanDialog from "#lib/ui/UnsavedPlanDialog.svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";

	interface Props {
		config: EditorConfig;
	}

	let { config }: Props = $props();

	const fromUrl = parseHash(location.hash);
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
		const editor = new Editor({
			api,
			minZoom: config.data_min_zoom,
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
	const floorplans = new FloorPlans({
		store: new IndexedDbPlanStore(),
		codec,
	});
	void floorplans.restore();
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
	let level = $state(fromUrl?.level ?? 0);
	let lastHash = "";
	let background = $state.raw<ImageryEntry | null>(null);
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

	function showBackground(entry: ImageryEntry | null) {
		background = entry;
		if (entry && !imageryUsed.includes(entry.name)) {
			imageryUsed = [...imageryUsed, entry.name];
		}
		if (map) void setBackground(map, entry);
	}

	/** The drawing tool on (P5.3.4; the split tool, P5.3.5), or null when browsing. */
	let drawing = $state<"point" | "line" | "area" | "split" | null>(null);
	/** The split tool's cut line, or the lasso, as drawn so far. */
	let cut = $state.raw<readonly Loc[]>([]);

	/** Turns a drawing tool on, or off when it is on already. */
	function draw(kind: "point" | "line" | "area" | "split") {
		drawing = drawing === kind ? null : kind;
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
		split: msg("split_hint"),
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
		delete: Trash,
	};

	/** What the map's clicks, drags and keys do now (see `edit/modes`). */
	const modeKind = $derived(
		planMode
			? floorplans.tool
				? "floorplan-tool"
				: "floorplan"
			: drawing
				? `draw-${drawing}`
				: "browse",
	);
	let modes = $state.raw<ModeManager>();

	// The indoor layers, floor plans and editing modes live as long as the map.
	$effect(() => {
		const instance = map;
		if (!instance) return;
		const indoor = new IndoorMap(instance);
		$effect(() => indoor.setFeatures(editor.features));
		$effect(() => indoor.setLevel(level));
		$effect(() => indoor.setSelected(editor.selection.ids));
		$effect(() => indoor.setHover(editor.selection.hover));
		$effect(() => indoor.setPlanMode(planMode));
		$effect(() => indoor.setBuildingsVisible(floorplans.buildings.visible));
		const stopDrawn = indoor.onDrawn((count) => (drawn = count));
		const overlay = new EditOverlay(instance);
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
				indoor.hitTest(point) === selected.id
				? { kind: "vertex", id: selected.id }
				: null;
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
								hitTest: (point) => indoor.hitTest(point),
								select: (id) => editor.select(id as EntityId | null),
								toggle: (id) => editor.selection.toggle(id as EntityId),
								lasso: (at) =>
									lassoDrag(at.lngLat, {
										onchange: (line) => (cut = line),
										onend: selectInLasso,
									}),
								pointer: (at) => (lastPointer = at?.lngLat ?? null),
								hover: (id) => editor.selection.setHover(id as EntityId | null),
								draggable: (point) => grabAt(point) !== null,
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
			stopDrawn();
			stopTiles();
			overlay.remove();
			marks.remove();
			layers.remove();
			indoor.remove();
		};
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
	 * Where a dragged node snaps (P5.3.2): onto a node, a side of a way, or a floor plan's
	 * vertex within 8 px on the shown level, leaving out the nodes dragged and their sides.
	 * Alt held: nowhere.
	 */
	function snapNode(
		at: MapPoint,
		exclude: ReadonlySet<NodeId>,
		keepSide: (side: Segment) => boolean = () => true,
	): SnapTarget | null {
		if (!map || at.altKey) return null;
		const area = areaAround(at.point, unprojectPoint);
		return snapAt(
			at.point,
			{
				nodes: editor.features
					.nodesNear(area, level)
					.filter((n) => !exclude.has(n.id)),
				segments: editor.features
					.segmentsNear(area, level)
					.filter(
						(s) => !exclude.has(s.a.id) && !exclude.has(s.b.id) && keepSide(s),
					),
				planVertices: floorplans.verticesNear(area, level),
			},
			projectLoc,
		);
	}

	function projectLoc(loc: Loc): { x: number; y: number } {
		return map?.project([loc[0], loc[1]]) ?? { x: Number.NaN, y: Number.NaN };
	}

	function unprojectPoint(point: { x: number; y: number }): Loc {
		const { lng, lat } = map?.unproject([point.x, point.y]) ?? {
			lng: 0,
			lat: 0,
		};
		return [lng, lat];
	}

	/** What the node being dragged moves with it (shared vertices), while dragging. */
	let dragHint = $state.raw<Message | null>(null);

	/** The map in view, as an extent. */
	function visibleExtent(): Extent | undefined {
		const bounds = map?.getBounds();
		return (
			bounds && {
				west: bounds.getWest(),
				south: bounds.getSouth(),
				east: bounds.getEast(),
				north: bounds.getNorth(),
			}
		);
	}

	/** The levels of the data in view, named, for the switcher; followed after each move. */
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

	/** Indoor features the map has drawn (for the e2e tests' `data-drawn`). */
	let drawn = $state<number>();
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
		editor.selected !== null || several !== null || planMode,
	);

	/** The side panel, which covers the left of the map while it is open. */
	let sidePanel = $state<HTMLElement>();

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

	// Keep the URL hash in sync with the map camera and the selected level.
	const hash = $derived(camera && formatHash({ ...camera, level }));
	$effect(() => {
		if (hash && hash !== lastHash) {
			lastHash = hash;
			void goto(resolve(hash), { replace: true, shallow: true });
		}
	});

	function visibleArea(): Bbox | undefined {
		const bounds = map?.getBounds();
		return (
			bounds && {
				west: bounds.getWest(),
				south: bounds.getSouth(),
				east: bounds.getEast(),
				north: bounds.getNorth(),
			}
		);
	}

	function onMove(next: Omit<View, "level">) {
		camera = next;
		const area = visibleArea();
		if (area) void editor.sync.loadView(area, next.zoom);
	}

	function showPlace(place: Place) {
		if (place.bbox) {
			const { west, south, east, north } = place.bbox;
			map?.fitBounds(
				[
					[west, south],
					[east, north],
				],
				{ maxZoom: 19, duration: 0 },
			);
		} else {
			map?.jumpTo({ center: [place.lon, place.lat], zoom: 19 });
		}
	}

	// Follow hash edits made by the user (typed URL, pasted link, back/forward).
	function onHashChange() {
		if (location.hash === lastHash) return;
		const view = parseHash(location.hash);
		if (!view) return;
		level = view.level;
		map?.jumpTo({ center: [view.lon, view.lat], zoom: view.zoom });
	}

	const mac = isMac();
	/** Shortcuts that apply in every mode but floor plan mode (OSM edits can't be seen there). */
	const SHORTCUTS = [
		{ combo: "1", run: () => draw("point") },
		{ combo: "2", run: () => draw("line") },
		{ combo: "3", run: () => draw("area") },
		{ combo: "X", run: () => draw("split") },
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
		if (modes?.key(event)) return;
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

	const statusMessage = $derived.by(() => {
		switch (editor.sync.status.kind) {
			case "loading":
				return "Loading OpenStreetMap data…";
			case "zoom-in":
				return "Zoom in to load indoor data here";
			case "error":
				return `Some data could not be loaded (${editor.sync.status.failed} area${editor.sync.status.failed > 1 ? "s" : ""}). Move the map to retry.`;
			default:
				return null;
		}
	});
</script>

<svelte:window
	onhashchange={onHashChange}
	onkeydown={onKeydown}
	onbeforeunload={onBeforeUnload}
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
			{#snippet child({
				props,
			})}
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
	kind: "point" | "line" | "area" | "split",
	label: string,
	key: string,
	Icon: Component,
)}
	<Tooltip.Root>
		<Tooltip.Trigger onclick={() => draw(kind)}>
			{#snippet child({
				props,
			})}
				<Button
					{...props}
					variant={drawing === kind ? "secondary" : "outline"}
					size="icon"
					aria-label={kind === "split"
						? "Split rooms"
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

{#snippet operationButton(
	operation: Operation,
	disabled: Message | null,
)}
	{@const Icon = OPERATION_ICONS[operation.id]}
	{@const label = t(operation.label)}
	<Tooltip.Root>
		<Tooltip.Trigger onclick={() => runOperation(operation)}>
			{#snippet child({
				props,
			})}
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

<MapView
	styleUrl={config.basemap_style}
	initialCamera={fromUrl ?? {
		zoom: config.map_initial_zoom,
		lat: config.map_initial_latlng[0],
		lon: config.map_initial_latlng[1],
	}}
	bind:map
	onmove={onMove}
	{drawn}
	{planTiles}
/>

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
		{:else}
			<FloorPlansPanel
				{floorplans}
				{decoders}
				getView={planView}
				{level}
				{toolMessage}
				onclose={closePlanMode}
				onshowlevel={(shown) => (level = shown)}
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

<div
	class="absolute top-4 z-20 flex flex-col items-start gap-2"
	style:left={panelOpen ? `calc(${shownPanelWidth}px + 1rem)` : "1rem"}
>
	<SearchPlace
		getView={visibleArea}
		onselect={showPlace}
		baseUrl={config.nominatim_url}
	/>
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
				<Button
					variant="outline"
					disabled={editor.history.editCount === 0}
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
				{@render drawButton("split", "Split", "X", Scissors)}
			</ButtonGroup.Root>
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
	<ImageryPicker
		center={camera && [camera.lon, camera.lat]}
		selected={background?.id ?? null}
		onselect={showBackground}
		indexUrl={config.imagery_index_url}
	/>
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
</div>

<div class="absolute top-4 right-4 z-10">
	<LevelControl bind:level levels={levelsInView} />
</div>

{#if statusMessage}
	<p
		role="status"
		data-testid="load-status"
		class={[
			"absolute bottom-10 left-1/2 z-10 -translate-x-1/2 rounded-full bg-popover px-4 py-1.5 text-sm shadow-md ring-1 ring-foreground/10",
			editor.sync.status.kind === "error"
				? "text-destructive"
				: "text-popover-foreground",
		]}
	>
		{statusMessage}
	</p>
{/if}

{#if drawing && !dragHint && !operationNote}
	<p
		role="status"
		data-testid="draw-hint"
		class="absolute bottom-20 left-1/2 z-10 max-w-[90%] -translate-x-1/2 rounded-full bg-popover px-4 py-1.5 text-center text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
	>
		{t(DRAW_HINTS[drawing])}
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

{#if repeating}
	<RepeatDialog
		id={repeating}
		{level}
		levels={levelsInView}
		near={nodesAround(repeating)}
		onclose={() => (repeating = null)}
	/>
{/if}
