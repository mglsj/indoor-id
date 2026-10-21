<script lang="ts">
	import FileImage from "@lucide/svelte/icons/file-image";
	import Redo2 from "@lucide/svelte/icons/redo-2";
	import Undo2 from "@lucide/svelte/icons/undo-2";
	import Upload from "@lucide/svelte/icons/upload";
	import { type Component, untrack } from "svelte";
	import { innerWidth } from "svelte/reactivity/window";
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
	import { ModeManager } from "#lib/edit/mode-manager.ts";
	import { browseMode } from "#lib/edit/modes/browse.ts";
	import {
		floorPlanMode,
		floorPlanToolMode,
	} from "#lib/edit/modes/floorplan.ts";
	import { workerCodec } from "#lib/floorplans/codec.ts";
	import { groundDistance, type LngLat } from "#lib/floorplans/georef.ts";
	import { planDecoders } from "#lib/floorplans/import.ts";
	import type { Message } from "#lib/i18n/messages.ts";
	import { setBackground } from "#lib/map/background.ts";
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
	import type { EntityId } from "#lib/osm/entity.ts";
	import { type Extent, extentsIntersect } from "#lib/osm/geometry.ts";
	import { entityExtent } from "#lib/osm/relations.ts";
	import { IndexedDbPlanStore } from "#lib/persist/plan-store.ts";
	import { Editor, setEditor } from "#lib/state/editor.svelte.ts";
	import {
		FloorPlans,
		type View as PlanView,
	} from "#lib/state/floorplans.svelte.ts";
	import { Session } from "#lib/state/session.svelte.ts";
	import FloorPlansPanel from "#lib/ui/FloorPlansPanel.svelte";
	import ImageryPicker from "#lib/ui/ImageryPicker.svelte";
	import Inspector from "#lib/ui/Inspector.svelte";
	import LevelControl from "#lib/ui/LevelControl.svelte";
	import MapView from "#lib/ui/MapView.svelte";
	import PanelResizer from "#lib/ui/PanelResizer.svelte";
	import {
		clampWidth,
		rememberedWidth,
		rememberWidth,
		widthBounds,
	} from "#lib/ui/panel-width.ts";
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
	/** Snapping distance for alignment clicks, in screen pixels. */
	const SNAP_DISTANCE = 8;

	let map = $state.raw<MapLibreMap>();
	let camera = $state.raw<Omit<View, "level">>();
	let level = $state(fromUrl?.level ?? 0);
	let lastHash = "";
	let background = $state.raw<ImageryEntry | null>(null);
	/** Imagery shown since the last upload, for the changeset's imagery_used tag. */
	let imageryUsed = $state<string[]>([]);

	function showBackground(entry: ImageryEntry | null) {
		background = entry;
		if (entry && !imageryUsed.includes(entry.name)) {
			imageryUsed = [...imageryUsed, entry.name];
		}
		if (map) void setBackground(map, entry);
	}

	/** What the map's clicks, drags and keys do now (see `edit/modes`). */
	const modeKind = $derived(
		!planMode ? "browse" : floorplans.tool ? "floorplan-tool" : "floorplan",
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
			switch (modeKind) {
				case "browse":
					manager.setMode(
						browseMode({
							hitTest: (point) => indoor.hitTest(point),
							select: (id) => editor.select(id as EntityId | null),
							hover: (id) => editor.selection.setHover(id as EntityId | null),
						}),
					);
					break;
				case "floorplan":
					manager.setMode(
						floorPlanMode({ map: instance, floorplans, close: closePlanMode }),
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
		return () => {
			modes = undefined;
			manager.remove();
			stopDrawn();
			stopTiles();
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
		// The square around the click, on the ground (all four corners: the map may be rotated).
		const d = SNAP_DISTANCE;
		const corners = [
			[-d, -d],
			[d, -d],
			[d, d],
			[-d, d],
		].map(([dx, dy]) =>
			LngLatClass.convert(
				map?.unproject([point.x + (dx ?? 0), point.y + (dy ?? 0)]) ?? lngLat,
			),
		);
		const area = {
			west: Math.min(...corners.map((c) => c.lng)),
			south: Math.min(...corners.map((c) => c.lat)),
			east: Math.max(...corners.map((c) => c.lng)),
			north: Math.max(...corners.map((c) => c.lat)),
		};
		const editing = floorplans.editing?.id;
		const tool = floorplans.tool;
		if (!(tool?.kind === "points" && tool.pending)) {
			return (
				nearest(
					point,
					floorplans.verticesNear(area, level, (p) => p.id === editing),
				) ?? clicked
			);
		}
		const nodes = editor.features
			.nodesNear(area, level)
			.map((node): LngLat => [node.loc[0], node.loc[1]]);
		return (
			nearest(point, nodes) ??
			nearest(
				point,
				floorplans.verticesNear(area, level, (p) => p.id !== editing),
			) ??
			clicked
		);
	}

	/** The position nearest a screen point, within 8 px of it; undefined when none is. */
	function nearest(
		point: { x: number; y: number },
		positions: readonly LngLat[],
	): LngLat | undefined {
		let best: LngLat | undefined;
		let bestDistance = SNAP_DISTANCE;
		for (const position of positions) {
			const screen = map?.project(position);
			if (!screen) continue;
			const distance = Math.hypot(screen.x - point.x, screen.y - point.y);
			if (distance < bestDistance) {
				bestDistance = distance;
				best = position;
			}
		}
		return best;
	}

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
		if (planMode || !shortcut) return;
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
{#if editor.selected || planMode}
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
				/>
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
	style:left={editor.selected || planMode
		? `calc(${shownPanelWidth}px + 1rem)`
		: "1rem"}
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
	<LevelControl bind:level levels={editor.features.levels} />
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

{#if saving}
	<SaveDialog
		{session}
		imagery={imageryUsed}
		{websiteUrl}
		onclose={() => (saving = false)}
	/>
{/if}

<UnsavedPlanDialog {floorplans} />
