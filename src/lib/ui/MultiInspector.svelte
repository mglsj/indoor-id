<script lang="ts">
	import Check from "@lucide/svelte/icons/check";
	import X from "@lucide/svelte/icons/x";
	import { untrack } from "svelte";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import { ScrollArea } from "#lib/components/shadcn/scroll-area/index.ts";
	import { labelFor } from "#lib/map/classify.ts";
	import type { Entity } from "#lib/osm/entity.ts";
	import {
		combineTags,
		editorPatch,
		editorTags,
		sharedPreset,
	} from "#lib/presets/multi.ts";
	import { getEditor } from "#lib/state/editor.svelte.ts";
	import FieldsSection from "#lib/ui/FieldsSection.svelte";
	import InspectorSection from "#lib/ui/InspectorSection.svelte";
	import PresetIcon from "#lib/ui/PresetIcon.svelte";
	import TagEditor from "#lib/ui/TagEditor.svelte";

	interface Props {
		/** The selected features (two or more). */
		entities: readonly Entity[];
	}

	let { entities }: Props = $props();
	const editor = getEditor();

	/** The features as selected: closing turns into a ✓ once one was changed. */
	const selectedAs = untrack(() => entities);
	const changed = $derived(entities.some((e, i) => e !== selectedAs[i]));

	const ids = $derived(entities.map((e) => e.id));
	const presets = $derived(entities.map((e) => editor.presetOf(e)));
	const preset = $derived(
		presets.every((p) => p !== undefined) ? sharedPreset(presets) : undefined,
	);
	const combined = $derived(combineTags(entities.map((e) => e.tags)));
	const shownTags = $derived(editorTags(combined));
	const mixed = $derived(new Set(combined.mixed.keys()));
</script>

<aside
	aria-label="Feature editor"
	class="flex h-full w-full flex-col border-r bg-background shadow-lg"
>
	<header class="flex items-center gap-2 border-b px-4 py-3">
		<h2 class="min-w-0 flex-1 truncate text-base font-semibold">
			Edit {entities.length} features
		</h2>
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={changed ? "Done" : "Close"}
			title={changed ? "Done" : "Close"}
			onclick={() => editor.select(null)}
		>
			{#if changed}
				<Check />
			{:else}
				<X />
			{/if}
		</Button>
	</header>

	<ScrollArea class="min-h-0 flex-1">
		<InspectorSection id="features" title={`Features (${entities.length})`}>
			<ul aria-label="Selected features" class="flex flex-col gap-1">
				{#each entities as entity, i (entity.id)}
					{@const type = presets[i]?.name ?? "Feature"}
					{@const label = labelFor(entity.tags)}
					<li
						class="flex items-center gap-1"
						onpointerenter={() => editor.selection.setHover(entity.id)}
						onpointerleave={() => editor.selection.setHover(null)}
					>
						<button
							type="button"
							class="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1.5 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
							aria-label={`Select ${type}${label ? ` ${label}` : ""}`}
							onclick={() => editor.select(entity.id)}
						>
							<PresetIcon icon={presets[i]?.icon} size={20} />
							<span class="min-w-0 flex-1 truncate">
								<span class="font-medium">{type}</span>
								{#if label}
									<span class="text-muted-foreground">{label}</span>
								{/if}
							</span>
						</button>
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label={`Deselect ${type}${label ? ` ${label}` : ""}`}
							title="Deselect"
							onclick={() => editor.selection.toggle(entity.id)}
						>
							<X />
						</Button>
					</li>
				{/each}
			</ul>
		</InspectorSection>

		{#if preset}
			<InspectorSection id="fields" title="Fields">
				{#key preset.id}
					<FieldsSection {entities} {preset} />
				{/key}
			</InspectorSection>
		{/if}

		<InspectorSection
			id="tags"
			title={`Tags (${Object.keys(shownTags).length})`}
			defaultOpen={false}
		>
			<TagEditor
				tags={shownTags}
				{mixed}
				onchange={(next) =>
					editor.history.patchTags(ids, editorPatch(combined, next))}
			/>
		</InspectorSection>
	</ScrollArea>
</aside>
