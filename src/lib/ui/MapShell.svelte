<script lang="ts" module>
	import type { Component, Snippet } from "svelte";

	/** A pane a page adds on the right of the map, next to the background's (iD's map panes). */
	export interface MapPane {
		readonly id: string;
		/** The button's text, and the pane's name. */
		readonly label: string;
		/** The button's tooltip. */
		readonly title: string;
		readonly icon: Component;
		/** A count shown on the button (the guides on the level), when above 0. */
		readonly badge?: number;
		/** The pane, given a function that closes it. */
		readonly content: Snippet<[close: () => void]>;
		/**
		 * Asked before the pane closes or another opens in its place: calls `close` once it may
		 * (the floor plans pane asks about unsaved changes first). Closes at once when unset.
		 */
		readonly beforeClose?: (close: () => void) => void;
	}
</script>

<script lang="ts">
	/**
	 * The map every page shows (R5): the MapLibre map with the indoor features of `getEditor()`,
	 * the shown level and its switcher, the URL hash, the background (the light basemap, imagery
	 * or a solid colour, chosen in a pane opened from the top right; the map stays light in the
	 * dark theme), place search (in the header, A.2) and the download status. Pages add their
	 * controls and panels through the snippets, and panes of their own beside the background's
	 * (`panes`, one open at a time); the editor (`EditorView`) adds modes, drawing, floor plans
	 * and upload on top. Pills at the bottom middle share one stack (A.2), so they never
	 * overlap: the page's `hints` on top, the load status, then the page's `modeBar`.
	 */
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import Layers from "@lucide/svelte/icons/layers";
	import type { Place } from "#lib/api/nominatim.ts";
	import { Badge } from "#lib/components/shadcn/badge/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import type { EditorConfig } from "#lib/config.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import type { FloorNumbering } from "#lib/levels/floor-numbering.ts";
	import {
		setBackground,
		setImageryDisplay,
		setSolidBackground,
	} from "#lib/map/background.ts";
	import { BASEMAP_STYLE, type Imagery } from "#lib/map/backgrounds.ts";
	import { editedFeatures } from "#lib/map/edited.ts";
	import {
		formatHash,
		parseHash,
		type MapView as View,
	} from "#lib/map/hash.ts";
	import { IndoorMap } from "#lib/map/indoor-map.ts";
	import type { Map as MapLibreMap } from "#lib/map/maplibre.ts";
	import type { Presentation } from "#lib/map/style/layers.ts";
	import { visibleExtent } from "#lib/map/view.ts";
	import { EARTH_RADIUS } from "#lib/osm/geometry.ts";
	import { AppearanceSettings } from "#lib/state/appearance.svelte.ts";
	import { BackgroundSettings } from "#lib/state/background.svelte.ts";
	import { getEditor } from "#lib/state/editor.svelte.ts";
	import BackgroundPane from "#lib/ui/BackgroundPane.svelte";
	import { getHeader, useHeaderSlot } from "#lib/ui/header.svelte.ts";
	import LevelControl from "#lib/ui/LevelControl.svelte";
	import MapView from "#lib/ui/MapView.svelte";
	import SearchPlace from "#lib/ui/SearchPlace.svelte";
	import StatusPill from "#lib/ui/StatusPill.svelte";
	import { goto } from "$app/navigation";

	type Camera = Omit<View, "level">;

	interface Props {
		config: EditorConfig;
		/** The shown level; starts from the URL hash. */
		level?: number;
		/** The MapLibre map, once created. */
		map?: MapLibreMap;
		/** The camera after the last move. */
		camera?: Camera;
		/** The background and area fill settings, for the editor's shortcuts. */
		background?: BackgroundSettings;
		/** The editor's colours for the grid, guides, selection and changes (A.4). */
		appearance?: AppearanceSettings;
		/** The indoor features' layers on the map, once the map exists. */
		indoor?: IndoorMap;
		/** Pixels the left side covers (a side panel): the controls go right of it. */
		left?: number;
		/** Floor plan tiles drawn, for the e2e tests' `data-plan-tiles`. */
		planTiles?: number;
		/** Indoor data drawn for editing (translucent) or viewing (V.1). */
		presentation?: Presentation;
		/** How unnamed levels are labelled in the switcher; their numbers when unset. */
		numbering?: FloorNumbering;
		/** Whether the level switcher shows: the editor's only in building mode (B.5). */
		levelSwitcher?: boolean;
		/** The imagery shown changed (null: the map alone), and once at first. */
		onbackground?: (imagery: Imagery | null) => void;
		/** Controls at the top left of the map. */
		controls?: Snippet;
		/** Controls under `controls`. */
		tools?: Snippet;
		/** Hints at the bottom middle, above the load status. */
		hints?: Snippet;
		/** The bar at the bottom middle, under the load status (building mode's). */
		modeBar?: Snippet;
		/** Panels, hints and dialogs over the map. */
		children?: Snippet;
		/** The page's side panel, for the "Skip to side panel" link (A.6) while it shows. */
		sidePanel?: HTMLElement;
		/** Panes of the page's own, opened from buttons under the background's. */
		panes?: readonly MapPane[];
		/** The pane open on the right: "background", a pane's id, or null. */
		openPane?: string | null;
	}

	const fromUrl = parseHash(location.hash);

	let {
		config,
		level = $bindable(fromUrl?.level ?? 0),
		map = $bindable(),
		camera = $bindable(),
		indoor = $bindable(),
		background = $bindable(),
		appearance = $bindable(),
		left = 0,
		planTiles,
		presentation = "edit",
		numbering,
		levelSwitcher = true,
		onbackground,
		controls,
		tools,
		hints,
		modeBar,
		children,
		panes = [],
		sidePanel,
		openPane = $bindable(null),
	}: Props = $props();

	const editor = getEditor();
	useHeaderSlot(getHeader(), "search", () => searchBox);
	useHeaderSlot(getHeader(), "skips", () => skipLinks);

	const skipTargets: ("map" | "panel")[] = $derived(
		sidePanel ? ["map", "panel"] : ["map"],
	);

	/** Focuses the map, or the side panel's first control, from a skip link (A.6). */
	function skipTo(target: "map" | "panel") {
		if (target === "map") {
			map?.getCanvas().focus();
			return;
		}
		const first = sidePanel?.querySelector<HTMLElement>(
			"button:not([disabled]), input:not([disabled]), [tabindex='0']",
		);
		first?.focus();
	}
	/** Enters what a link names: a building, or `here`, the loose indoor data (B.3). */
	function enterFromUrl(building: NonNullable<View["building"]>) {
		if (building === "here") editor.scope.enterLoose();
		else editor.scope.enter(building);
	}
	if (fromUrl?.building) enterFromUrl(fromUrl.building);
	let lastHash = "";
	const settings = new BackgroundSettings(browserStorage());
	background = settings;
	const looks = new AppearanceSettings(browserStorage());
	appearance = looks;
	/** The background pane, on the right of the map. */
	const backgroundOpen = $derived(openPane === "background");
	const shownPane = $derived(panes.find((pane) => pane.id === openPane));
	const paneOpen = $derived(backgroundOpen || shownPane !== undefined);
	/** Opens `next` (null: none), once the pane open now may close. */
	function switchPane(next: string | null) {
		const leaving = panes.find((pane) => pane.id === openPane);
		const go = () => (openPane = next);
		if (leaving?.beforeClose && next !== openPane) leaving.beforeClose(go);
		else go();
	}
	function toggle(pane: string) {
		switchPane(openPane === pane ? null : pane);
	}
	const closePane = () => switchPane(null);
	/** Its width in pixels (20rem). */
	const PANE_WIDTH = 320;
	/** Indoor features the map has drawn (for the e2e tests' `data-drawn`). */
	let drawn = $state<number>();

	// The indoor layers live as long as the map.
	$effect(() => {
		const instance = map;
		if (!instance) return;
		const layers = new IndoorMap(instance);
		indoor = layers;
		$effect(() =>
			layers.setLook({
				presentation,
				fill: settings.areaFill,
				// The Map data pane's colours (A.4), the editor's only.
				...(presentation === "edit"
					? { selection: looks.selectionColor, edits: looks.editPalette }
					: {}),
				// Building mode (B.1): the map fades indoor features, a building what is outside
				// (or hides it, its surroundings off: B.2).
				scope:
					presentation === "edit"
						? editor.scope.current
							? editor.scope.surroundings
								? "building"
								: "alone"
							: "map"
						: undefined,
			}),
		);
		$effect(() => layers.setInside(editor.inside));
		// iD's "Highlight changes", in the editor.
		$effect(() =>
			layers.setEdited(
				presentation === "edit" && settings.highlightEdits
					? editedFeatures(editor.graph)
					: new Map(),
			),
		);
		$effect(() => layers.setFeatures(editor.features));
		$effect(() => layers.setLevel(level));
		$effect(() => layers.setSelected(editor.selection.ids));
		$effect(() => layers.setHover(editor.selection.hover));
		const stopDrawn = layers.onDrawn((count) => (drawn = count));
		return () => {
			indoor = undefined;
			stopDrawn();
			layers.remove();
		};
	});

	/** Ground metres per CSS pixel at the map's centre (Web Mercator, 512 px tiles). */
	function metresPerPixel(instance: MapLibreMap | undefined): number {
		if (!instance) return 0;
		const lat = (instance.getCenter().lat * Math.PI) / 180;
		return (
			(2 * Math.PI * EARTH_RADIUS * Math.cos(lat)) /
			(512 * 2 ** instance.getZoom())
		);
	}

	function browserStorage(): Storage | undefined {
		try {
			return localStorage;
		} catch {
			return undefined;
		}
	}

	// The imagery, its offset and the solid colour follow the settings.
	$effect(() => {
		if (map) void setSolidBackground(map, settings.solid);
	});
	$effect(() => {
		if (map) void setBackground(map, settings.imagery, settings.offset);
	});
	$effect(() => {
		if (map) setImageryDisplay(map, settings.display);
	});
	$effect(() => {
		onbackground?.(settings.imagery);
	});

	/**
	 * The levels for the switcher, named: in a building, all of the building's whatever is in
	 * view (A.5: they no longer come and go with the camera); otherwise those of the data in
	 * view, followed after each move.
	 */
	const levelsInView = $derived.by(() => {
		const extent =
			editor.scope.current?.extent ?? (camera && visibleExtent(map));
		return extent ? editor.features.levelsIn(extent, editor.floors) : [];
	});

	// Keep the URL hash in sync with the map camera and the shown level.
	const hash = $derived(
		camera &&
			formatHash({
				...camera,
				level,
				...(editor.scope.id && { building: editor.scope.id }),
				...(editor.scope.loose && { building: "here" as const }),
			}),
	);
	$effect(() => {
		if (hash && hash !== lastHash) {
			lastHash = hash;
			// On this page: the editor's is `/`, the viewer's `/view`.
			void goto(new URL(hash, location.href), {
				replace: true,
				shallow: true,
			});
		}
	});

	function onMove(next: Camera) {
		camera = next;
		const area = visibleExtent(map);
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
		if (view.building) enterFromUrl(view.building);
		else editor.scope.leave();
		map?.jumpTo({ center: [view.lon, view.lat], zoom: view.zoom });
	}

	const statusMessage = $derived.by(() => {
		switch (editor.sync.status.kind) {
			case "loading":
				return t(msg("load_osm"));
			case "zoom-in":
				return t(msg("load_zoom_in"));
			case "error":
				return t(msg("load_failed", { count: editor.sync.status.failed }));
			default:
				return null;
		}
	});
</script>

<svelte:window onhashchange={onHashChange} />

{#snippet skipLinks()}
	<!-- Shown once focused: the first Tab of the page (A.6). -->
	<div
		class="pointer-events-none absolute top-2 left-2 z-50 flex gap-2 *:pointer-events-auto"
	>
		{#each skipTargets as target (target)}
			<Button
				variant="default"
				size="sm"
				class="sr-only focus-visible:not-sr-only"
				onclick={() => skipTo(target)}
				>{t(msg(target === "map" ? "skip_to_map" : "skip_to_panel"))}</Button
			>
		{/each}
	</div>
{/snippet}

{#snippet searchBox()}
	<SearchPlace
		getView={() => visibleExtent(map)}
		onselect={showPlace}
		baseUrl={config.nominatim_url}
	/>
{/snippet}

{@render children?.()}

<!-- The page's tools (A.2), never under the right column: as wide as the map leaves them, a
     container their labels follow (`@min-[44rem]:`); on a phone the right column is narrower
     (A.7). -->
<div
	class="pointer-events-none absolute top-4 z-20 flex w-[calc(100%-var(--covered)-15rem)] flex-col items-start gap-2 @container *:pointer-events-auto max-sm:w-[calc(100%-var(--covered)-10rem)]"
	style:left={left > 0 ? `calc(${left}px + 1rem)` : "1rem"}
	style:--covered="{left + (paneOpen ? PANE_WIDTH : 0)}px"
>
	{@render controls?.()}
	{@render tools?.()}
</div>

<!-- The map after the side panel and the tools, before the right column: the keyboard order
     follows the screen, left to right (A.6). It is in the flow; the rest is placed over it. -->
<MapView
	styleUrl={BASEMAP_STYLE}
	coveredRight={paneOpen ? PANE_WIDTH : 0}
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

<div
	class="absolute top-4 z-10 flex flex-col items-end gap-2"
	style:right={paneOpen ? `calc(${PANE_WIDTH}px + 1rem)` : "1rem"}
>
	<div class="rounded-md bg-background shadow-md">
		<Button
			variant={backgroundOpen ? "secondary" : "outline"}
			aria-pressed={backgroundOpen}
			title={t(msg("background_toggle"))}
			onclick={() => toggle("background")}
		>
			<Layers data-icon="inline-start" />
			{t(msg("background"))}
		</Button>
	</div>
	{#each panes as pane (pane.id)}
		{@const open = openPane === pane.id}
		<div class="rounded-md bg-background shadow-md">
			<Button
				variant={open ? "secondary" : "outline"}
				aria-pressed={open}
				title={pane.title}
				onclick={() => toggle(pane.id)}
			>
				<pane.icon data-icon="inline-start" />
				{pane.label}
				{#if pane.badge}
					<Badge variant="secondary" class="tabular-nums">{pane.badge}</Badge>
				{/if}
			</Button>
		</div>
	{/each}
	{#if levelSwitcher}
		<LevelControl bind:level levels={levelsInView} {numbering} />
	{/if}
</div>

{#if backgroundOpen}
	<div
		class="absolute inset-y-0 right-0 z-30 max-w-full"
		style:width="{PANE_WIDTH}px"
	>
		<BackgroundPane
			{settings}
			showSwap={presentation === "edit"}
			metresPerPixel={() => metresPerPixel(map)}
			onclose={closePane}
		/>
	</div>
{:else if shownPane}
	<div
		class="absolute inset-y-0 right-0 z-30 max-w-full"
		style:width="{PANE_WIDTH}px"
	>
		{@render shownPane.content(closePane)}
	</div>
{/if}

<!-- One stack at the bottom middle (A.2), above the attribution: hints, the load status, the
     mode bar. -->
<div
	class="pointer-events-none absolute bottom-9 z-20 flex w-max max-w-[min(90%,40rem)] -translate-x-1/2 flex-col items-center gap-2 *:pointer-events-auto"
	style:left="calc({left}px + (100% - {left}px - {paneOpen
		? PANE_WIDTH
		: 0}px) / 2)"
	data-testid="bottom-stack"
>
	{@render hints?.()}
	{#if statusMessage}
		<StatusPill
			testid="load-status"
			tone={editor.sync.status.kind === "error" ? "error" : "normal"}
		>
			{#if editor.sync.status.kind === "error"}
				<CircleAlert class="size-4 shrink-0" aria-hidden="true" />
			{/if}
			{statusMessage}
		</StatusPill>
	{/if}
	{@render modeBar?.()}
</div>
