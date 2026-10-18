<script lang="ts">
	import ArrowLeft from "@lucide/svelte/icons/arrow-left";
	import Check from "@lucide/svelte/icons/check";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import ExternalLink from "@lucide/svelte/icons/external-link";
	import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
	import X from "@lucide/svelte/icons/x";
	import { untrack } from "svelte";
	import * as Alert from "#lib/components/shadcn/alert/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import { ScrollArea } from "#lib/components/shadcn/scroll-area/index.ts";
	import { t } from "#lib/i18n/messages.ts";
	import { type EntityId, isNewId, osmId } from "#lib/osm/entity.ts";
	import type { Extent } from "#lib/osm/geometry.ts";
	import type { Preset } from "#lib/presets/presets.ts";
	import { keySuggestions, valueSuggestions } from "#lib/presets/tag-table.ts";
	import { presetReference } from "#lib/presets/wiki.ts";
	import { fix, setPreset } from "#lib/state/commands.ts";
	import { type Editor, getEditor } from "#lib/state/editor.svelte.ts";
	import FieldsSection from "#lib/ui/FieldsSection.svelte";
	import InfoButton from "#lib/ui/InfoButton.svelte";
	import InspectorSection from "#lib/ui/InspectorSection.svelte";
	import MembersSection from "#lib/ui/MembersSection.svelte";
	import PresetIcon from "#lib/ui/PresetIcon.svelte";
	import PresetList from "#lib/ui/PresetList.svelte";
	import RelationsSection from "#lib/ui/RelationsSection.svelte";
	import TagEditor from "#lib/ui/TagEditor.svelte";
	import TagReference from "#lib/ui/TagReference.svelte";
	import { timeAgo } from "#lib/ui/time-ago.ts";

	interface Props {
		/**
		 * The selected entity (the panel is only shown with one). The panel is made anew for each
		 * selection: what it shows first, and its ✓, are about the feature as selected.
		 */
		entity: NonNullable<Editor["selected"]>;
		/** openstreetmap.org, or the configured website, for "View on openstreetmap.org". */
		websiteUrl: string;
		/** The part of the map in view, for the relations a feature can be added to. */
		viewExtent?: () => Extent | undefined;
		/** Fits a feature in view. */
		onzoom?: (id: EntityId) => void;
		/** Selects a feature, and shows it when out of view (a relation's member). */
		onshow?: (id: EntityId) => void;
		/** Shown, not edited (P5.3's hover preview): every input and button is disabled. */
		readonly?: boolean;
	}

	let {
		entity,
		websiteUrl,
		viewExtent,
		onzoom,
		onshow,
		readonly = false,
	}: Props = $props();
	const editor = getEditor();

	/** The feature as selected: closing turns into a ✓ once it was changed. */
	const selectedAs = untrack(() => entity);
	const changed = $derived(entity !== selectedAs);

	/** A new feature without tags starts on its type, as iD's `newFeature`. */
	let choosing = $state(
		untrack(() => isNewId(entity.id) && Object.keys(entity.tags).length === 0),
	);

	const geometry = $derived(editor.geometryOf(entity));
	const preset = $derived(editor.presetOf(entity));
	let showPresetDocs = $state(false);
	/** The OSM wiki's documentation of the feature type, once ⓘ is clicked. */
	const presetDocs = $derived.by(() => {
		const reference = preset && presetReference(preset);
		return showPresetDocs && reference
			? editor.catalog.services.wikibase?.docs(reference)
			: undefined;
	});
	const issues = $derived(editor.issuesOf(entity.id));
	/** Features without a matching type show their tags, the only way to edit them. */
	const isFallback = $derived(
		preset !== undefined && editor.catalog.presets?.isFallback(preset) === true,
	);
	const tagCount = $derived(Object.keys(entity.tags).length);
	const osmUrl = $derived(
		`${websiteUrl.replace(/\/$/, "")}/${entity.type}/${osmId(entity.id)}`,
	);
	const lastEdited = $derived(
		entity.timestamp ? timeAgo(entity.timestamp) : null,
	);
	function choose(next: Preset) {
		setPreset(editor, entity, next);
		choosing = false;
	}
</script>

<aside
	aria-label="Feature editor"
	class="flex h-full w-full flex-col border-r bg-background shadow-lg"
>
	<header class="flex items-center gap-2 border-b px-4 py-3">
		{#if choosing}
			<Button
				variant="ghost"
				size="icon-sm"
				class="-ml-2"
				aria-label="Back to the feature"
				title="Back to the feature"
				onclick={() => (choosing = false)}
			>
				<ArrowLeft />
			</Button>
		{/if}
		<h2 class="min-w-0 flex-1 truncate text-base font-semibold">
			{choosing ? "Select feature type" : "Edit feature"}
		</h2>
		{#if !readonly}
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
		{/if}
	</header>

	{#if choosing && editor.catalog.presets}
		<PresetList
			presets={editor.catalog.presets}
			{geometry}
			current={preset}
			recent={editor.catalog.recentPresets.list(geometry)}
			onchoose={choose}
			oncancel={() => (choosing = false)}
			docs={editor.catalog.services.wikibase
				? (reference) =>
						editor.catalog.services.wikibase?.docs(reference) ??
						Promise.resolve(null)
				: undefined}
		/>
	{:else}
		<ScrollArea class="min-h-0 flex-1">
			<fieldset disabled={readonly} class="contents">
				<InspectorSection id="feature-type" title="Feature Type">
					<div class="flex items-center gap-1">
						<button
							type="button"
							class="flex w-full items-center gap-3 rounded-md border p-2 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
							aria-label={`${preset?.name ?? "Feature"}, change feature type`}
							onclick={() => (choosing = true)}
						>
							<PresetIcon icon={preset?.icon} size={28} />
							<span class="min-w-0 flex-1">
								<span class="block truncate font-medium">
									{preset?.name ?? "Feature"}
								</span>
								<span class="block text-xs text-muted-foreground"
									>{entity.id}</span
								>
							</span>
							<ChevronRight class="size-4 shrink-0 text-muted-foreground" />
						</button>
						{#if editor.catalog.services.wikibase &&
							preset &&
							presetReference(preset)}
							<InfoButton
								label={preset?.name ?? "Feature"}
								expanded={showPresetDocs}
								ontoggle={() => (showPresetDocs = !showPresetDocs)}
							/>
						{/if}
					</div>
					{#if presetDocs}
						<div class="mt-2"><TagReference docs={presetDocs} /></div>
					{/if}
				</InspectorSection>

				{#if issues.length > 0}
					<InspectorSection id="issues" title={`Issues (${issues.length})`}>
						<div class="flex flex-col gap-2">
							{#each issues as issue (issue.id)}
								<Alert.Root role="note">
									<TriangleAlert />
									<Alert.Description>{t(issue.message)}</Alert.Description>
									{#if issue.fix}
										<div class="col-start-2 mt-2">
											<Button
												variant="outline"
												size="xs"
												onclick={() => fix(editor, issue)}
											>
												{t(issue.fix.label)}
											</Button>
										</div>
									{/if}
								</Alert.Root>
							{/each}
						</div>
					</InspectorSection>
				{/if}

				<InspectorSection id="fields" title="Fields">
					{#if preset}
						{#key preset.id}
							<FieldsSection entities={[entity]} {preset} {readonly} />
						{/key}
					{/if}
				</InspectorSection>

				<InspectorSection
					id="tags"
					title={`Tags (${tagCount})`}
					defaultOpen={false}
					forceOpen={isFallback}
				>
					<TagEditor
						tags={entity.tags}
						onchange={(tags) => editor.history.setTags(entity.id, tags)}
						suggestKeys={editor.catalog.services.taginfo
							? (query) =>
									editor.catalog.services.taginfo
										?.keys({ query, geometry })
										.then((found) =>
											keySuggestions(
												found,
												query,
												entity.tags,
												editor.catalog.discardedKeys,
											),
										) ?? Promise.resolve([])
							: undefined}
						suggestValues={editor.catalog.services.taginfo
							? (key, query) =>
									editor.catalog.services.taginfo
										?.values({ key, query, geometry })
										.then((found) => valueSuggestions(found, query)) ??
									Promise.resolve([])
							: undefined}
						docs={editor.catalog.services.wikibase
							? (reference) =>
									editor.catalog.services.wikibase?.docs(reference) ??
									Promise.resolve(null)
							: undefined}
					/>
				</InspectorSection>

				{#if entity.type === "relation"}
					<MembersSection
						relation={entity}
						onshow={onshow ?? ((id) => editor.select(id))}
						{onzoom}
					/>
				{/if}
				<RelationsSection {entity} {viewExtent} {onzoom} />
			</fieldset>
		</ScrollArea>

		{#if !isNewId(entity.id)}
			<footer class="border-t px-4 py-3 text-sm">
				<a
					href={osmUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
				>
					View on openstreetmap.org
					<ExternalLink class="size-3.5" aria-hidden="true" />
				</a>
				{#if lastEdited}
					<p class="text-xs text-muted-foreground">
						Last edited {lastEdited}{entity.user ? ` by ${entity.user}` : ""}
					</p>
				{/if}
			</footer>
		{/if}
	{/if}
</aside>
