<script lang="ts">
	/**
	 * The map every page shows (R5): the MapLibre map with the indoor features of `getEditor()`,
	 * the shown level and its switcher, the URL hash, background imagery, place search and the
	 * download status. Pages add their controls and panels through the snippets; the editor
	 * (`EditorView`) adds modes, drawing, floor plans and upload on top.
	 */
	import type { Snippet } from "svelte";
	import type { Place } from "#lib/api/nominatim.ts";
	import type { EditorConfig } from "#lib/config.ts";
	import { setBackground } from "#lib/map/background.ts";
	import {
		formatHash,
		parseHash,
		type MapView as View,
	} from "#lib/map/hash.ts";
	import type { ImageryEntry } from "#lib/map/imagery.ts";
	import { IndoorMap } from "#lib/map/indoor-map.ts";
	import type { Map as MapLibreMap } from "#lib/map/maplibre.ts";
	import { visibleExtent } from "#lib/map/view.ts";
	import { getEditor } from "#lib/state/editor.svelte.ts";
	import ImageryPicker from "#lib/ui/ImageryPicker.svelte";
	import LevelControl from "#lib/ui/LevelControl.svelte";
	import MapView from "#lib/ui/MapView.svelte";
	import SearchPlace from "#lib/ui/SearchPlace.svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";

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
		/** A background was picked (null: none). */
		onbackground?: (entry: ImageryEntry | null) => void;
		/** Controls under the place search. */
		controls?: Snippet;
		/** Controls under the imagery picker. */
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
		onbackground,
		controls,
		tools,
		children,
	}: Props = $props();

	const editor = getEditor();
	let lastHash = "";
	let background = $state.raw<ImageryEntry | null>(null);
	/** Indoor features the map has drawn (for the e2e tests' `data-drawn`). */
	let drawn = $state<number>();

	// The indoor layers live as long as the map.
	$effect(() => {
		const instance = map;
		if (!instance) return;
		const layers = new IndoorMap(instance);
		indoor = layers;
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

	function showBackground(entry: ImageryEntry | null) {
		background = entry;
		onbackground?.(entry);
		if (map) void setBackground(map, entry);
	}

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
			void goto(resolve(hash), { replace: true, shallow: true });
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
	<ImageryPicker
		center={camera && [camera.lon, camera.lat]}
		selected={background?.id ?? null}
		onselect={showBackground}
		indexUrl={config.imagery_index_url}
	/>
	{@render tools?.()}
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
