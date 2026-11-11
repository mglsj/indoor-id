<script lang="ts">
	/**
	 * The viewer's side panel (V.3): the selected feature's details, a search over the names
	 * and refs of the places loaded, and the named places on the shown level in view. A click
	 * on a place shows it (`onshow`: its level, the map on it, selected).
	 */
	import Search from "@lucide/svelte/icons/search";
	import * as InputGroup from "#lib/components/shadcn/input-group/index.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import type { EntityId } from "#lib/osm/entity.ts";
	import type { Extent } from "#lib/osm/geometry.ts";
	import { getEditor } from "#lib/state/editor.svelte.ts";
	import FeatureCard from "#lib/ui/FeatureCard.svelte";
	import {
		type Place,
		placesOf,
		placesOnLevel,
		searchPlaces,
	} from "#lib/view/places.ts";

	interface Props {
		level: number;
		/** The map's extent, or null before it has one. */
		extent: Extent | null;
		websiteUrl: string;
		onshow: (place: Place) => void;
	}

	let { level, extent, websiteUrl, onshow }: Props = $props();
	const editor = getEditor();

	let query = $state("");
	const places = $derived(placesOf(editor.features.byId.values()));
	const found = $derived(searchPlaces(places, query));
	const searching = $derived(query.trim() !== "");
	const shown = $derived(
		searching ? found : extent ? placesOnLevel(places, level, extent) : [],
	);

	function levelsText(place: Place): string | null {
		const levels = place.levels;
		if (!levels || levels.length === 0) return null;
		const text =
			levels.length > 2
				? `${String(levels[0])}–${String(levels.at(-1))}`
				: levels.join(";");
		return t(msg("view_place_level", { levels: text }));
	}
</script>

<aside
	aria-label={t(msg("view_places"))}
	data-testid="viewer-panel"
	class="flex h-full w-full flex-col border-r bg-background shadow-lg"
>
	{#if editor.selected}
		{#key editor.selected.id}
			<FeatureCard
				entity={editor.selected}
				{websiteUrl}
				onclose={() => editor.select(null)}
				class="max-h-[50%] border-b"
			/>
		{/key}
	{/if}
	<div class="border-b p-3">
		<InputGroup.Root>
			<InputGroup.Addon>
				<Search />
			</InputGroup.Addon>
			<InputGroup.Input
				type="search"
				aria-label={t(msg("view_search"))}
				placeholder={t(msg("view_search"))}
				bind:value={query}
			/>
		</InputGroup.Root>
	</div>
	<h2 class="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">
		{searching ? t(msg("view_results")) : t(msg("view_on_level"))}
	</h2>
	{#if shown.length === 0}
		<p class="px-4 py-2 text-sm text-muted-foreground">
			{searching ? t(msg("view_no_results")) : t(msg("view_no_places"))}
		</p>
	{:else}
		<ul
			class="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
			aria-label={t(msg("view_places"))}
		>
			{#each shown as place (place.id)}
				<li>
					<button
						type="button"
						class={[
							"flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
							editor.selection.has(place.id as EntityId) && "bg-muted",
						]}
						onclick={() => onshow(place)}
					>
						<span class="min-w-0 flex-1 truncate">{place.label}</span>
						{#if place.ref}
							<span class="text-xs text-muted-foreground tabular-nums"
								>{place.ref}</span
							>
						{/if}
						{#if searching && levelsText(place)}
							<span class="text-xs whitespace-nowrap text-muted-foreground"
								>{levelsText(place)}</span
							>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</aside>
