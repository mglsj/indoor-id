<script lang="ts">
	import Lock from "@lucide/svelte/icons/lock";
	import type { Snippet } from "svelte";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import type { Tags } from "#lib/osm/tags.ts";
	import type { Field as PresetField } from "#lib/presets/presets.ts";
	import { fieldReference } from "#lib/presets/wiki.ts";
	import AccessField from "#lib/ui/AccessField.svelte";
	import AddressField from "#lib/ui/AddressField.svelte";
	import CheckField from "#lib/ui/CheckField.svelte";
	import ChipsField from "#lib/ui/ChipsField.svelte";
	import ComboField from "#lib/ui/ComboField.svelte";
	import {
		type FieldChange,
		type FieldContext,
		fieldInputId,
		type MixedValues,
		NOT_MIXED,
	} from "#lib/ui/field-context.ts";
	import InfoButton from "#lib/ui/InfoButton.svelte";
	import LocalizedField from "#lib/ui/LocalizedField.svelte";
	import RadioField from "#lib/ui/RadioField.svelte";
	import TagReference from "#lib/ui/TagReference.svelte";
	import TextareaField from "#lib/ui/TextareaField.svelte";
	import TextField from "#lib/ui/TextField.svelte";
	import WikidataField from "#lib/ui/WikidataField.svelte";
	import WikipediaField from "#lib/ui/WikipediaField.svelte";

	interface Props {
		field: PresetField;
		/** The tags of the feature, or those the features edited share. */
		tags: Tags;
		/** Keys whose values differ between the features edited ("Multiple values"). */
		mixed?: MixedValues;
		context: FieldContext;
		/** A change; `live` while text is typed (one undo step with the final value). */
		onchange: (change: FieldChange, live?: boolean) => void;
		/** Shown, not editable (the name of a feature linked to Wikidata). */
		locked?: boolean;
		/** Buttons at the end of the label row (remove, revert). */
		actions?: Snippet;
	}

	let {
		field,
		tags,
		mixed = NOT_MIXED,
		context,
		onchange,
		locked = false,
		actions,
	}: Props = $props();

	const id = $derived(fieldInputId(field));
	const reference = $derived(fieldReference(field, tags));
	let showDocs = $state(false);
	/** Asked for when ⓘ is clicked, and again when the value documented changes. */
	const docs = $derived(
		showDocs && reference ? context.docs?.(reference) : undefined,
	);
	const value = $derived(field.key ? tags[field.key] : undefined);
	const isMixed = $derived(field.key !== undefined && mixed.has(field.key));
	const kind = $derived.by(() => {
		switch (field.type) {
			case "check":
			case "defaultCheck":
			case "onewayCheck":
				return "check";
			case "radio":
			case "structureRadio":
				return "radio";
			case "combo":
			case "typeCombo":
			case "networkCombo":
				return "single-combo";
			case "semiCombo":
			case "multiCombo":
			case "manyCombo":
				return "chips";
			case "access":
				return "access";
			case "address":
				return "address";
			case "localized":
				return "localized";
			case "wikidata":
				return "wikidata";
			case "wikipedia":
				return "wikipedia";
			case "textarea":
				return "textarea";
			default:
				// text, tel, email, url, identifier, schedule, date, colour, number, integer.
				return "text";
		}
	});

	/** Sets the field's key to what was typed or chosen; nothing removes it. */
	function set(next: string | undefined) {
		if (field.key) onchange({ [field.key]: next || undefined });
	}
</script>

<Field.Field class="gap-1.5">
	<div class="flex min-h-6 items-center gap-1">
		<Field.Label for={id}>{field.label}</Field.Label>
		{#if locked}
			<Lock
				role="img"
				aria-label={`${field.label} is locked: the feature is linked to Wikidata. Its tags can still be edited in Tags.`}
				class="size-3.5 text-muted-foreground"
			/>
		{/if}
		<span class="ml-auto flex items-center">
			{@render actions?.()}
			{#if reference && context.docs}
				<InfoButton
					label={field.label}
					expanded={showDocs}
					ontoggle={() => (showDocs = !showDocs)}
				/>
			{/if}
		</span>
	</div>
	{#if docs}
		<TagReference {docs} />
	{/if}
	{#if kind === "single-combo"}
		<ComboField
			{field}
			{value}
			{context}
			{locked}
			mixed={isMixed}
			onchange={set}
		/>
	{:else if kind === "chips"}
		<ChipsField {field} {tags} {mixed} {context} {locked} {onchange} />
	{:else if kind === "check"}
		<CheckField {field} {value} {locked} mixed={isMixed} onchange={set} />
	{:else if kind === "radio"}
		<RadioField {field} {tags} {context} {locked} {onchange} />
	{:else if kind === "access"}
		<AccessField {field} {tags} {mixed} {locked} {onchange} />
	{:else if kind === "address"}
		<AddressField {field} {tags} {mixed} {context} {locked} {onchange} />
	{:else if kind === "localized"}
		<LocalizedField {field} {tags} {mixed} {locked} {onchange} />
	{:else if kind === "wikidata"}
		<WikidataField {field} {tags} {mixed} {context} {locked} {onchange} />
	{:else if kind === "wikipedia"}
		<WikipediaField {field} {tags} {mixed} {context} {locked} {onchange} />
	{:else if kind === "textarea"}
		<TextareaField {field} {tags} {mixed} {locked} {onchange} />
	{:else}
		<TextField {field} {tags} {mixed} {locked} {onchange} />
	{/if}
</Field.Field>
