<script lang="ts">
	import X from "@lucide/svelte/icons/x";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import type { UnmappedFloor } from "#lib/edit/unmapped-floor.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import { mapFloor } from "#lib/state/commands.ts";
	import { getEditor } from "#lib/state/editor.svelte.ts";
	import PresetList from "#lib/ui/PresetList.svelte";

	interface Props {
		/** The unmapped floor selected (P5.4a). */
		floor: UnmappedFloor;
	}

	let { floor }: Props = $props();
	const editor = getEditor();
	const area = $derived(
		floor.area >= 10 ? Math.round(floor.area) : floor.area.toFixed(1),
	);
</script>

<aside
	aria-label={t(msg("floor_title"))}
	class="flex h-full w-full flex-col border-r bg-background shadow-lg"
>
	<header class="flex items-center gap-2 border-b px-4 py-3">
		<h2 class="min-w-0 flex-1 truncate text-base font-semibold">
			{t(msg("floor_title"))}
		</h2>
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label="Close"
			title="Close"
			onclick={() => editor.selectFloor(null)}
		>
			<X />
		</Button>
	</header>
	<div class="flex flex-col gap-2 border-b px-4 py-3 text-sm">
		<p data-testid="floor-summary">
			{t(msg("floor_summary", { level: floor.level, area }))}
		</p>
		<p class="text-muted-foreground">{t(msg("floor_help"))}</p>
		<Button
			variant="outline"
			disabled={editor.history.locked}
			onclick={() => mapFloor(editor, null)}
		>
			{t(msg("floor_map_area"))}
		</Button>
	</div>
	{#if editor.catalog.presets}
		<PresetList
			presets={editor.catalog.presets}
			geometry="area"
			current={undefined}
			recent={editor.catalog.recentPresets.list("area")}
			onchoose={(preset) => mapFloor(editor, preset)}
			oncancel={() => editor.selectFloor(null)}
			docs={editor.catalog.services.wikibase
				? (reference) =>
						editor.catalog.services.wikibase?.docs(reference) ??
						Promise.resolve(null)
				: undefined}
		/>
	{/if}
</aside>
