<script lang="ts">
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import Search from "@lucide/svelte/icons/search";
	import { type Place, searchPlaces } from "#lib/api/nominatim.ts";
	import type { Bbox } from "#lib/api/osm-api.ts";
	import * as Alert from "#lib/components/shadcn/alert/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as InputGroup from "#lib/components/shadcn/input-group/index.ts";
	import { ScrollArea } from "#lib/components/shadcn/scroll-area/index.ts";
	import { Spinner } from "#lib/components/shadcn/spinner/index.ts";
	import { msg, t } from "#lib/i18n/messages.ts";

	interface Props {
		/** Area to search near, usually the visible map. */
		getView: () => Bbox | undefined;
		onselect: (place: Place) => void;
		baseUrl?: string;
	}

	let { getView, onselect, baseUrl }: Props = $props();

	let query = $state("");
	let results = $state.raw<Place[] | null>(null);
	let error = $state<string | null>(null);
	let searching = $state(false);
	let controller: AbortController | undefined;

	async function search(event: SubmitEvent) {
		event.preventDefault();
		const near = getView();
		if (!near) return;
		controller?.abort();
		controller = new AbortController();
		searching = true;
		error = null;
		try {
			results = await searchPlaces(query, {
				near,
				baseUrl,
				signal: controller.signal,
			});
		} catch (e) {
			if ((e as Error).name !== "AbortError") {
				error = (e as Error).message;
				results = null;
			}
		} finally {
			searching = false;
		}
	}

	function select(place: Place) {
		results = null;
		onselect(place);
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === "Escape") results = null;
	}
</script>

<!-- In the header (A.2): the results and errors open below it, over the page. -->
<div class="relative w-full" {onkeydown} role="presentation">
	<search>
		<form onsubmit={search} class="rounded-md bg-background">
			<InputGroup.Root>
				<InputGroup.Input
					type="search"
					aria-label={t(msg("search_search_a_place"))}
					placeholder={t(msg("search_search_a_place"))}
					autocomplete="off"
					bind:value={query}
				/>
				<InputGroup.Addon align="inline-end">
					<InputGroup.Button
						type="submit"
						size="icon-xs"
						aria-label={t(msg("search_search"))}
						disabled={searching}
					>
						{#if searching}
							<Spinner aria-label={t(msg("search_searching"))} />
						{:else}
							<Search />
						{/if}
					</InputGroup.Button>
				</InputGroup.Addon>
			</InputGroup.Root>
		</form>
	</search>

	{#if results}
		<div
			class="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
		>
			<ScrollArea class="*:data-[slot=scroll-area-viewport]:max-h-80">
				<ul
					aria-label={t(msg("search_search_results"))}
					class="flex flex-col p-1"
				>
					{#each results as place (place.description)}
						<li>
							<Button
								variant="ghost"
								class="h-auto w-full flex-col items-start gap-0 py-2 text-left whitespace-normal"
								onclick={() => select(place)}
							>
								<span>{place.name}</span>
								{#if place.description !== place.name}
									<span
										class="w-full truncate text-xs font-normal text-muted-foreground"
									>
										{place.description}
									</span>
								{/if}
							</Button>
						</li>
					{:else}
						<li class="px-2 py-2 text-sm text-muted-foreground">
							{t(msg("search_no_place_found"))}
						</li>
					{/each}
				</ul>
			</ScrollArea>
		</div>
	{/if}

	{#if error}
		<Alert.Root
			variant="destructive"
			class="absolute inset-x-0 top-full z-50 mt-1 shadow-md"
		>
			<CircleAlert />
			<Alert.Description>{error}</Alert.Description>
		</Alert.Root>
	{/if}
</div>
