<script lang="ts">
	import type { Tags } from "#lib/osm/tags.ts";
	import { accessOptions, accessPlaceholder } from "#lib/presets/access.ts";
	import type { Field } from "#lib/presets/presets.ts";
	import ComboField from "#lib/ui/ComboField.svelte";
	import {
		type FieldContext,
		fieldInputId,
		type MixedValues,
		NOT_MIXED,
		type TagPatch,
	} from "#lib/ui/field-context.ts";

	interface Props {
		/** iD's access field: one row per kind of traffic (`access`, `foot`…). */
		field: Field;
		tags: Tags;
		/** Rows whose values differ between the features edited. */
		mixed?: MixedValues;
		locked: boolean;
		onchange: (patch: TagPatch) => void;
	}

	let { field, tags, mixed = NOT_MIXED, locked, onchange }: Props = $props();

	const noContext: FieldContext = { deprecated: () => [] };

	/** A row's input: the usual values, the implied access as placeholder. */
	const rowField = (type: string, first: boolean): Field => ({
		// The first row takes the field's id, so the field's label points at it.
		id: first ? field.id : `${field.id}-${type}`,
		key: type,
		type: "combo",
		label: field.types?.[type] ?? type,
		placeholder: accessPlaceholder(field, tags, type),
		options: accessOptions(field, type),
		terms: [],
		universal: false,
		snakeCase: true,
		caseSensitive: false,
		customValues: true,
		autoSuggestions: false,
		allowDuplicates: false,
	});
</script>

<div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
	{#each field.keys ?? [] as type, i (type)}
		{@const row = rowField(type, i === 0)}
		<label for={fieldInputId(row)} class="text-sm text-muted-foreground"
			>{row.label}</label
		>
		<ComboField
			field={row}
			value={tags[type]}
			context={noContext}
			{locked}
			mixed={mixed.has(type)}
			onchange={(value) => onchange({ [type]: value })}
		/>
	{/each}
</div>
