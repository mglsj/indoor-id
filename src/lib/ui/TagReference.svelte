<script lang="ts">
	import BookOpen from "@lucide/svelte/icons/book-open";
	import Pencil from "@lucide/svelte/icons/pencil";
	import { linkifyWikiText, type TagDocs } from "#lib/api/osm-wikibase.ts";
	import { Spinner } from "#lib/components/shadcn/spinner/index.ts";
	import { msg, t } from "#lib/i18n/messages.ts";

	interface Props {
		/** The documentation to show; null when the wiki has none. */
		docs: Promise<TagDocs | null>;
	}

	let { docs }: Props = $props();

	/** Images that didn't load are left out, as iD does. */
	let brokenImage = $state(false);
</script>

<!-- iD's tag reference: the OSM wiki's description of a tag, its image and its page. -->
<div class="flex flex-col gap-2 rounded-md bg-muted/50 p-2.5 text-sm">
	{#await docs}
		<p class="flex items-center gap-2 text-muted-foreground">
			<Spinner class="size-3.5" />
			{t(msg("reference_loading_documentation"))}
		</p>
	{:then found}
		{#if !found || (!found.description && !found.wiki)}
			<p class="text-muted-foreground">
				{t(msg("reference_there_is_no_documentation"))}
			</p>
		{:else}
			{#if found.imageUrl && !brokenImage}
				<img
					src={found.imageUrl}
					alt={found.title}
					class="max-h-40 self-start rounded-sm object-contain"
					onerror={() => (brokenImage = true)}
				>
			{/if}
			<p>
				{#each linkifyWikiText(found.description) as part, i (i)}
					{#if "href" in part}
						<a
							href={part.href}
							target="_blank"
							rel="noopener noreferrer"
							class="underline-offset-4 hover:underline"
							><code class="text-xs">{part.tag}</code></a
						>
					{:else}
						{part.text}
					{/if}
				{/each}
				<a
					href={found.editUrl}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={t(msg("reference_edit_or_translate_the"))}
					title={t(msg("reference_edit_or_translate_the"))}
					class="ml-1 inline-flex align-middle text-muted-foreground hover:text-foreground"
					><Pencil class="size-3.5" /></a
				>
			</p>
			{#if found.wiki}
				<a
					href={found.wiki.url}
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex items-center gap-1 self-start font-medium underline-offset-4 hover:underline"
				>
					<BookOpen class="size-3.5" aria-hidden="true" />
					{t(msg("reference_view_documentation"))}
				</a>
			{/if}
		{/if}
	{:catch}
		<p class="text-muted-foreground">
			{t(msg("reference_the_documentation_could_not"))}
		</p>
	{/await}
</div>
