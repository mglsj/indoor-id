<script lang="ts">
	/**
	 * The viewer (V.1): indoor data from Overpass on the shared map shell, read-only, with no
	 * account. A click selects a feature and shows its details; the floor numbering setting
	 * labels unnamed levels as the reader counts floors. What this browser uploaded lately is
	 * laid over Overpass answers until Overpass catches up (`RecentUploads`).
	 */
	import { untrack } from "svelte";
	import { Overpass } from "#lib/api/overpass.ts";
	import { RecentUploads } from "#lib/api/recent-uploads.ts";
	import * as ToggleGroup from "#lib/components/shadcn/toggle-group/index.ts";
	import type { EditorConfig } from "#lib/config.ts";
	import { isForMap } from "#lib/edit/keys.ts";
	import { ModeManager } from "#lib/edit/mode-manager.ts";
	import { browseMode } from "#lib/edit/modes/browse.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import {
		defaultNumbering,
		type FloorNumbering,
	} from "#lib/levels/floor-numbering.ts";
	import type { IndoorMap } from "#lib/map/indoor-map.ts";
	import type { Map as MapLibreMap } from "#lib/map/maplibre.ts";
	import type { EntityId } from "#lib/osm/entity.ts";
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

	const editor = untrack(() => {
		const overpass = new Overpass({ baseUrl: config.overpass_url });
		const recent = new RecentUploads();
		return new Editor({
			api: {
				loadMap: async (bbox) => recent.patch(await overpass.loadMap(bbox)),
				loadRelation: async (id) =>
					recent.patch(await overpass.loadRelation(id)),
				upload: () => overpass.upload(),
			},
			minZoom: Math.min(MIN_ZOOM, config.data_min_zoom),
			// An Overpass error says nothing about the area's size: never split tiles.
			loader: { zoom: TILE_ZOOM, concurrency: 2, tooLarge: () => false },
		});
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
	let modes = $state.raw<ModeManager>();

	// Browsing only: a click selects, the pointer hovers.
	$effect(() => {
		const instance = map;
		const layers = indoor;
		if (!instance || !layers) return;
		const manager = new ModeManager(instance);
		modes = manager;
		manager.setMode(
			browseMode({
				hitTest: (point) => layers.hitTest(point),
				select: (id) => editor.select(id as EntityId | null),
				hover: (id) => editor.selection.setHover(id as EntityId | null),
			}),
		);
		return () => {
			modes = undefined;
			manager.remove();
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
