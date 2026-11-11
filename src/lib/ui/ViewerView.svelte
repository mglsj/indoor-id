<script lang="ts">
	/**
	 * The viewer (V.1): indoor data from Overpass on the shared map shell, read-only, with no
	 * account. A click selects a feature and shows its details; the floor numbering setting
	 * labels unnamed levels as the reader counts floors. What this browser uploaded lately is
	 * laid over Overpass answers until Overpass catches up (`RecentUploads`). Zoomed out,
	 * bubbles show where indoor data is (`Discovery`, V.2).
	 */
	import { mode } from "mode-watcher";
	import { untrack } from "svelte";
	import { Overpass } from "#lib/api/overpass.ts";
	import { RecentUploads } from "#lib/api/recent-uploads.ts";
	import * as ToggleGroup from "#lib/components/shadcn/toggle-group/index.ts";
	import type { EditorConfig } from "#lib/config.ts";
	import { isForMap } from "#lib/edit/keys.ts";
	import { ModeManager } from "#lib/edit/mode-manager.ts";
	import { viewMode } from "#lib/edit/modes/view.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import {
		defaultNumbering,
		type FloorNumbering,
	} from "#lib/levels/floor-numbering.ts";
	import { DiscoveryLayer } from "#lib/map/discovery-layer.ts";
	import type { IndoorMap } from "#lib/map/indoor-map.ts";
	import type { Map as MapLibreMap } from "#lib/map/maplibre.ts";
	import { visibleExtent } from "#lib/map/view.ts";
	import type { EntityId } from "#lib/osm/entity.ts";
	import { centresCollection, Discovery } from "#lib/state/discovery.svelte.ts";
	import { Editor, setEditor } from "#lib/state/editor.svelte.ts";
	import FeatureCard from "#lib/ui/FeatureCard.svelte";
	import MapShell from "#lib/ui/MapShell.svelte";

	interface Props {
		config: EditorConfig;
	}

	let { config }: Props = $props();

	/**
	 * Overpass serves areas the OSM API would refuse, but each tile is one query on a shared
	 * server: big tiles (zoom 15), two at a time, from zoom 16.
	 */
	const MIN_ZOOM = 16;
	const TILE_ZOOM = 15;

	const { editor, discovery, dataZoom } = untrack(() => {
		const overpass = new Overpass({ baseUrl: config.overpass_url });
		const recent = new RecentUploads();
		const dataZoom = Math.min(MIN_ZOOM, config.data_min_zoom);
		const editor = new Editor({
			api: {
				loadMap: async (bbox) => recent.patch(await overpass.loadMap(bbox)),
				loadRelation: async (id) =>
					recent.patch(await overpass.loadRelation(id)),
				upload: () => overpass.upload(),
			},
			minZoom: dataZoom,
			// An Overpass error says nothing about the area's size: never split tiles.
			loader: { zoom: TILE_ZOOM, concurrency: 2, tooLarge: () => false },
		});
		const discovery = new Discovery({
			load: (bbox) => overpass.indoorCentres(bbox),
			maxZoom: dataZoom,
		});
		return { editor, discovery, dataZoom };
	});
	setEditor(editor);
	const websiteUrl = untrack(() => config.oauth_url ?? config.osm_api_url);

	const NUMBERING_KEY = "indoorid.floorNumbering";
	let numbering = $state<FloorNumbering>(readNumbering());

	function readNumbering(): FloorNumbering {
		try {
			const saved = localStorage.getItem(NUMBERING_KEY);
			if (saved === "from-0" || saved === "from-1") return saved;
		} catch {
			// Blocked storage: the browser's locale decides.
		}
		return defaultNumbering(navigator.language);
	}

	function setNumbering(value: string) {
		if (value !== "from-0" && value !== "from-1") return;
		numbering = value;
		try {
			localStorage.setItem(NUMBERING_KEY, value);
		} catch {
			// Kept for this page only.
		}
	}

	let level = $state<number>(0);
	let map = $state.raw<MapLibreMap>();
	let indoor = $state.raw<IndoorMap>();
	let camera = $state.raw<{ zoom: number; lat: number; lon: number }>();
	let modes = $state.raw<ModeManager>();

	// Zoomed out, the centres of indoor spaces in view.
	$effect(() => {
		const area = camera && visibleExtent(map);
		if (camera && area) void discovery.loadView(area, camera.zoom);
	});

	// Browsing only: a click selects, the pointer hovers; a click on a bubble zooms in.
	$effect(() => {
		const instance = map;
		const layers = indoor;
		if (!instance || !layers) return;
		const bubbles = new DiscoveryLayer(instance, dataZoom);
		$effect(() => bubbles.setData(centresCollection(discovery.centres)));
		$effect(() => bubbles.setTheme(mode.current === "dark" ? "dark" : "light"));
		const manager = new ModeManager(instance);
		modes = manager;
		manager.setMode(
			viewMode({
				bubbleAt: (point) => bubbles.bubbleAt(point),
				openBubble: (bubble) => void bubbles.open(bubble),
				hitTest: (point) => layers.hitTest(point),
				select: (id) => editor.select(id as EntityId | null),
				hover: (id) => editor.selection.setHover(id as EntityId | null),
			}),
		);
		return () => {
			modes = undefined;
			manager.remove();
			bubbles.remove();
		};
	});
</script>

<!-- Escape clears the selection, as in the editor. -->
<svelte:window
	onkeydown={(event) => {
		if (isForMap(event)) modes?.key(event);
	}}
/>

<MapShell
	{config}
	bind:level
	bind:map
	bind:indoor
	bind:camera
	presentation="view"
	{numbering}
>
	{#snippet tools()}
		<div class="rounded-md bg-background shadow-md">
			<ToggleGroup.Root
				type="single"
				variant="outline"
				size="sm"
				aria-label={t(msg("view_numbering"))}
				bind:value={() => numbering, setNumbering}
			>
				<ToggleGroup.Item
					value="from-0"
					title={t(msg("view_numbering_from_0_title"))}
				>
					{t(msg("view_numbering_from_0"))}
				</ToggleGroup.Item>
				<ToggleGroup.Item
					value="from-1"
					title={t(msg("view_numbering_from_1_title"))}
				>
					{t(msg("view_numbering_from_1"))}
				</ToggleGroup.Item>
			</ToggleGroup.Root>
		</div>
	{/snippet}

	{#if editor.selected}
		<div class="absolute bottom-10 left-4 z-30">
			{#key editor.selected.id}
				<FeatureCard
					entity={editor.selected}
					{websiteUrl}
					onclose={() => editor.select(null)}
				/>
			{/key}
		</div>
	{/if}
</MapShell>
