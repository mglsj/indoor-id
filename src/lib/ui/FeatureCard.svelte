<script lang="ts">
	/**
	 * A feature's details in the viewer (V.1), read-only: what it is (its preset), its name, its
	 * levels and its tags, with a link to it on openstreetmap.org. V.3 grows this into the side
	 * panel with search and room lists.
	 */
	import ExternalLink from "@lucide/svelte/icons/external-link";
	import X from "@lucide/svelte/icons/x";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import { featureLevels } from "#lib/levels/feature-levels.ts";
	import { formatLevels } from "#lib/levels/levels.ts";
	import { type Entity, osmId } from "#lib/osm/entity.ts";
	import { getEditor } from "#lib/state/editor.svelte.ts";

	interface Props {
		entity: Entity;
		/** openstreetmap.org, or the instance the data comes from. */
		websiteUrl: string;
		onclose: () => void;
	}

	let { entity, websiteUrl, onclose }: Props = $props();
	const editor = getEditor();

	const preset = $derived(editor.presetOf(entity));
	const title = $derived(
		entity.tags.name ??
			entity.tags.ref ??
			preset?.name ??
			t(msg("view_feature")),
	);
	const subtitle = $derived(
		preset && preset.name !== title ? preset.name : undefined,
	);
	const levels = $derived(featureLevels(entity.tags));
	const tags = $derived(
		Object.entries(entity.tags).sort(([a], [b]) => a.localeCompare(b)),
	);
	const osmUrl = $derived(
		`${websiteUrl.replace(/\/+$/, "")}/${entity.type}/${osmId(entity.id)}`,
	);
</script>

<aside
	aria-label={title}
	data-testid="feature-card"
	class="flex max-h-[min(32rem,calc(100vh-8rem))] w-80 max-w-[calc(100vw-2rem)] flex-col rounded-md bg-background text-sm shadow-lg ring-1 ring-foreground/10"
>
	<header class="flex items-start gap-2 border-b px-4 py-3">
		<div class="min-w-0 flex-1">
			<h2 class="truncate text-base font-semibold">{title}</h2>
			{#if subtitle || levels}
				<p class="truncate text-muted-foreground">
					{[
						subtitle,
						levels && t(msg("view_levels", { levels: formatLevels(levels) })),
					]
						.filter(Boolean)
						.join(" · ")}
				</p>
			{/if}
		</div>
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={t(msg("view_close"))}
			title={t(msg("view_close"))}
			onclick={onclose}
		>
			<X />
		</Button>
	</header>
	{#if tags.length > 0}
		<dl
			aria-label={t(msg("view_tags"))}
			class="grid min-h-0 grid-cols-[auto_1fr] gap-x-3 gap-y-1 overflow-y-auto px-4 py-3 font-mono text-xs"
		>
			{#each tags as [key, value] (key)}
				<dt class="text-muted-foreground">{key}</dt>
				<dd class="break-all">{value}</dd>
			{/each}
		</dl>
	{/if}
	<footer class="border-t px-4 py-2">
		<a
			class="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
			href={osmUrl}
			target="_blank"
			rel="noopener"
		>
			{t(msg("view_on_osm"))}
			<ExternalLink class="size-3" />
		</a>
	</footer>
</aside>
