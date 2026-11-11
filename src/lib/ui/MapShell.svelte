<script lang="ts">
	/**
	 * The map every page shows (R5): the MapLibre map with the indoor features of `getEditor()`,
	 * the shown level and its switcher, the URL hash, the background (the basemap in the theme's
	 * colours, imagery, in a pane on the right), place search and the download status. Pages add their controls and panels through the snippets; the editor
	 * (`EditorView`) adds modes, drawing, floor plans and upload on top.
	 */
	import Layers from "@lucide/svelte/icons/layers";
	import { mode } from "mode-watcher";
	import type { Snippet } from "svelte";
	import type { Place } from "#lib/api/nominatim.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import type { EditorConfig } from "#lib/config.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import type { FloorNumbering } from "#lib/levels/floor-numbering.ts";
	import { setBackground } from "#lib/map/background.ts";
	import { BASEMAP_STYLES, type Imagery } from "#lib/map/backgrounds.ts";
	import { setBasemap } from "#lib/map/basemap.ts";
	import {
		formatHash,
		parseHash,
		type MapView as View,
	} from "#lib/map/hash.ts";
	import { IndoorMap } from "#lib/map/indoor-map.ts";
	import type { Map as MapLibreMap } from "#lib/map/maplibre.ts";
	import type { Presentation } from "#lib/map/style/layers.ts";
	import { visibleExtent } from "#lib/map/view.ts";
	import { BackgroundSettings } from "#lib/state/background.svelte.ts";
	import { getEditor } from "#lib/state/editor.svelte.ts";
	import BackgroundPane from "#lib/ui/BackgroundPane.svelte";
	import LevelControl from "#lib/ui/LevelControl.svelte";
	import MapView from "#lib/ui/MapView.svelte";
	import SearchPlace from "#lib/ui/SearchPlace.svelte";
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
		/** The imagery shown changed (null: the map alone), and once at first. */
		onbackground?: (imagery: Imagery | null) => void;
		/** Controls under the place search. */
		controls?: Snippet;
		/** Controls under the background button. */
		tools?: Snippet;
		/** Panels, hints and dialogs over the map. */
		children?: Snippet;
	}

	const fromUrl = parseHash(location.hash);

	let {
		config,
		level = $bindable(fromUrl?.level ?? 0),
		map = $bindable(),
		camera = $bindable(),
		indoor = $bindable(),
		left = 0,
		planTiles,
		presentation = "edit",
		numbering,
		onbackground,
		controls,
		tools,
		children,
	}: Props = $props();

	const editor = getEditor();
	let lastHash = "";
	const background = new BackgroundSettings(browserStorage());
	/** The background pane, on the right of the map. */
	let backgroundOpen = $state(false);
	/** Its width in pixels (20rem). */
	const PANE_WIDTH = 320;
	const theme = $derived(mode.current === "dark" ? "dark" : "light");
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
				theme,
			}),
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

	function browserStorage(): Storage | undefined {
		try {
			return localStorage;
		} catch {
			return undefined;
		}
	}

	// The basemap follows the theme; the imagery and its offset follow the settings.
	$effect(() => {
		if (map) void setBasemap(map, BASEMAP_STYLES[theme]).catch(() => {});
	});
	$effect(() => {
		if (map) void setBackground(map, background.imagery, background.offset);
	});
	$effect(() => {
		onbackground?.(background.imagery);
	});

	/** The levels of the data in view, named, for the switcher; followed after each move. */
	const levelsInView = $derived.by(() => {
		const extent = camera && visibleExtent(map);
		return extent ? editor.features.levelsIn(extent) : [];
	});

	// Keep the URL hash in sync with the map camera and the shown level.
	const hash = $derived(camera && formatHash({ ...camera, level }));
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
		map?.jumpTo({ center: [view.lon, view.lat], zoom: view.zoom });
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

<svelte:window onhashchange={onHashChange} />

<MapView
	styleUrl={BASEMAP_STYLES[theme]}
	dark={theme === "dark"}
	coveredRight={backgroundOpen ? PANE_WIDTH : 0}
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

{@render children?.()}

<div
	class="absolute top-4 z-20 flex flex-col items-start gap-2"
	style:left={left > 0 ? `calc(${left}px + 1rem)` : "1rem"}
>
	<SearchPlace
		getView={() => visibleExtent(map)}
		onselect={showPlace}
		baseUrl={config.nominatim_url}
	/>
	{@render controls?.()}
	<div class="rounded-md bg-background shadow-md">
		<Button
			variant={backgroundOpen ? "secondary" : "outline"}
			aria-pressed={backgroundOpen}
			title={t(msg("background_toggle"))}
			onclick={() => (backgroundOpen = !backgroundOpen)}
		>
			<Layers data-icon="inline-start" />
			{t(msg("background"))}
		</Button>
	</div>
	{@render tools?.()}
</div>

<div
	class="absolute top-4 z-10"
	style:right={backgroundOpen ? `calc(${PANE_WIDTH}px + 1rem)` : "1rem"}
>
	<LevelControl bind:level levels={levelsInView} {numbering} />
</div>

{#if backgroundOpen}
	<div
		class="absolute inset-y-0 right-0 z-30 max-w-full"
		style:width="{PANE_WIDTH}px"
	>
		<BackgroundPane
			settings={background}
			onclose={() => (backgroundOpen = false)}
		/>
	</div>
{/if}

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
