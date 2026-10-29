<script lang="ts">
	import Plus from "@lucide/svelte/icons/plus";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import Undo2 from "@lucide/svelte/icons/undo-2";
	import { tick } from "svelte";
	import { SvelteSet } from "svelte/reactivity";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as Command from "#lib/components/shadcn/command/index.ts";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import * as Popover from "#lib/components/shadcn/popover/index.ts";
	import type { Entity, EntityId } from "#lib/osm/entity.ts";
	import type { Tags } from "#lib/osm/tags.ts";
	import { addressSuggestions } from "#lib/presets/address.ts";
	import {
		addField,
		fieldList,
		hasValue,
		isLocked,
		isModified,
		matchesField,
		removeField,
		revertField,
	} from "#lib/presets/field-list.ts";
	import { combineTags, tagDiff } from "#lib/presets/multi.ts";
	import type { Preset, Field as PresetField } from "#lib/presets/presets.ts";
	import type { TagReference } from "#lib/presets/wiki.ts";
	import { getEditor } from "#lib/state/editor.svelte.ts";
	import FieldInput from "#lib/ui/FieldInput.svelte";
	import {
		type FieldChange,
		type FieldContext,
		fieldInputId,
	} from "#lib/ui/field-context.ts";

	interface Props {
		/** The features edited (one until multi-selection): their values shown together. */
		entities: readonly Entity[];
		/** Their type; the section is made anew when it changes, as in iD. */
		preset: Preset;
		/** Shown, not edited (the hover preview): no input takes text, no button shows. */
		readonly?: boolean;
	}

	let { entities, preset, readonly = false }: Props = $props();
	const editor = getEditor();

	/** The feature fields are looked up for (its geometry, the data around it). */
	const entity = $derived(entities[0] as Entity);
	const ids = $derived(entities.map((e) => e.id));
	const combined = $derived(combineTags(entities.map((e) => e.tags)));

	/** Fields added from "Add field", or emptied here: they stay until the feature is left. */
	const added = new SvelteSet<string>();
	let adding = $state(false);
	let query = $state("");

	const list = $derived(
		editor.catalog.presets
			? fieldList(
					editor.catalog.presets,
					preset,
					combined.tags,
					editor.geometryOf(entity),
					added,
				)
			: { shown: [], addable: [] },
	);
	const found = $derived(
		query.trim()
			? list.addable.filter((f) => matchesField(f, query))
			: list.addable,
	);
	/** iD's hint: the first fields that can be added. */
	const hint = $derived(
		list.addable
			.slice(0, 3)
			.map((f) => f.label)
			.join(", ") + (list.addable.length > 3 ? "…" : ""),
	);

	const context: FieldContext = {
		get suggest() {
			const taginfo = editor.catalog.services.taginfo;
			if (!taginfo) return undefined;
			return (field: PresetField, query: string) => {
				const geometry = editor.geometryOf(entity);
				return field.type === "multiCombo"
					? taginfo.multikeys({ query: `${field.key}${query}`, geometry })
					: taginfo.values({ key: field.key ?? "", query, geometry });
			};
		},
		deprecated: (key) => editor.catalog.deprecatedValues.get(key) ?? [],
		field: (id) => editor.catalog.presets?.field(id),
		amend: (work) => {
			// Tags looked up after an edit (a Wikidata item's article) follow one feature only.
			if (entities.length !== 1) return;
			const after = editor.graph;
			const id = entity.id;
			work
				.then((patch) => editor.history.amend(after, id, patch))
				.catch(() => {});
		},
		get wikidata() {
			return editor.catalog.services.wikidata;
		},
		get searchWikipedia() {
			return editor.catalog.services.searchWikipedia;
		},
		get docs() {
			const wikibase = editor.catalog.services.wikibase;
			return wikibase
				? (reference: TagReference) => wikibase.docs(reference)
				: undefined;
		},
		nearby: (key, part) =>
			addressSuggestions(editor.graph, entity.id, part, key).map(
				(s) => s.value,
			),
	};

	/** Applies a field's change to every feature's tags as they are now (`live` while typing). */
	function setField(change: FieldChange, live = false) {
		editor.history.patchTags(ids, change, { live });
	}

	/** Each feature's tags made into others, as a change of only what differs. */
	function changeEach(next: (tags: Tags, id: EntityId) => Tags) {
		editor.history.patchTags(ids, (tags, id) => tagDiff(tags, next(tags, id)));
	}

	function remove(field: PresetField) {
		added.add(field.id);
		changeEach((tags) => removeField(field, tags));
	}

	function revert(field: PresetField) {
		changeEach((tags, id) =>
			revertField(field, editor.history.downloadedTags(id), tags),
		);
	}

	async function add(field: PresetField) {
		adding = false;
		query = "";
		added.add(field.id);
		changeEach((tags) => addField(field, tags));
		await tick();
		document.getElementById(fieldInputId(field))?.focus();
	}

	const lockedAny = (field: PresetField) =>
		entities.some((e) => isLocked(field, e.tags));
	const modifiedAny = (field: PresetField) =>
		entities.some((e) =>
			isModified(field, editor.history.downloadedTags(e.id), e.tags),
		);
	const valueAny = (field: PresetField) =>
		entities.some((e) => hasValue(field, e.tags));
</script>

<!-- Disabled, so is every input and button in it (the hover preview). -->
<fieldset disabled={readonly} class="contents">
	<Field.Group class="gap-4">
		{#each list.shown as field (field.id)}
			{@const locked = lockedAny(field)}
			<FieldInput
				{field}
				{locked}
				tags={combined.tags}
				mixed={combined.mixed}
				{context}
				onchange={setField}
			>
				{#snippet actions()}
					{#if !readonly && !locked && modifiedAny(field)}
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label={`Revert ${field.label}`}
							title="Revert to the downloaded value"
							onclick={() => revert(field)}
						>
							<Undo2 />
						</Button>
					{/if}
					{#if !readonly && !locked && valueAny(field)}
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label={`Remove ${field.label}`}
							title="Remove"
							class="text-muted-foreground hover:text-destructive"
							onclick={() => remove(field)}
						>
							<Trash2 />
						</Button>
					{/if}
				{/snippet}
			</FieldInput>
		{/each}
	</Field.Group>
</fieldset>

{#if !readonly && list.addable.length > 0}
	<Popover.Root bind:open={adding}>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="outline"
					class="mt-4 w-full justify-start font-normal"
					aria-label="Add field"
				>
					<Plus />
					<span class="truncate text-muted-foreground">Add field: {hint}</span>
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content class="w-(--bits-popover-anchor-width) p-0" align="start">
			<Command.Root shouldFilter={false} label="Search fields">
				<Command.Input bind:value={query} placeholder="Search fields" />
				<Command.List>
					<Command.Empty>No field found</Command.Empty>
					<Command.Group>
						{#each found as field (field.id)}
							<Command.Item value={field.id} onSelect={() => add(field)}>
								{field.label}
							</Command.Item>
						{/each}
					</Command.Group>
				</Command.List>
			</Command.Root>
		</Popover.Content>
	</Popover.Root>
{/if}
