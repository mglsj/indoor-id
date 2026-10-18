<script lang="ts">
	import type { Tags } from "#lib/osm/tags.ts";
	import { ADDRESS_ROWS, ADDRESS_WIDTHS } from "#lib/presets/address.ts";
	import type { Field } from "#lib/presets/presets.ts";
	import { cleanValue } from "#lib/presets/text.ts";
	import ComboField from "#lib/ui/ComboField.svelte";
	import {
		type FieldContext,
		fieldInputId,
		type MixedValues,
		NOT_MIXED,
		type TagPatch,
	} from "#lib/ui/field-context.ts";

	interface Props {
		/** iD's address field: `addr:*` parts in rows. */
		field: Field;
		tags: Tags;
		/** Parts whose values differ between the features edited. */
		mixed?: MixedValues;
		context: FieldContext;
		locked: boolean;
		/** A change; `live` while typing (kept as typed, one undo step with the final value). */
		onchange: (patch: TagPatch, live?: boolean) => void;
	}

	let {
		field,
		tags,
		mixed = NOT_MIXED,
		context,
		locked,
		onchange,
	}: Props = $props();

	const prefix = $derived(field.key ?? "addr");

	/** A part's input: a combo offering the values found around the feature, as typed. */
	const partField = (part: string, first: boolean): Field => ({
		// The first part takes the field's id, so its label points at it.
		id: first ? field.id : `${field.id}-${part}`,
		key: `${prefix}:${part}`,
		type: "combo",
		label: field.placeholders?.[part] ?? part,
		placeholder: field.placeholders?.[part] ?? part,
		options: [],
		terms: [],
		universal: false,
		snakeCase: false,
		caseSensitive: true,
		customValues: true,
		autoSuggestions: true,
		allowDuplicates: false,
	});

	/** Suggestions come from the loaded data, not taginfo. */
	const partContext: FieldContext = {
		deprecated: () => [],
		suggest: (part, query) =>
			Promise.resolve(
				(
					context.nearby?.(prefix, (part.key ?? "").slice(prefix.length + 1)) ??
					[]
				)
					.filter((v) => v.toLowerCase().includes(query.toLowerCase()))
					.map((value) => ({ value, title: value })),
			),
	};
</script>

<div class="flex flex-col gap-1.5">
	{#each ADDRESS_ROWS as row, r (row.join())}
		{@const total = row.reduce(
			(sum, part) => sum + (ADDRESS_WIDTHS[part] ?? 0.5),
			0,
		)}
		<div class="flex gap-1.5">
			{#each row as part, p (part)}
				{@const sub = partField(part, r === 0 && p === 0)}
				<div
					style:flex-basis="{((ADDRESS_WIDTHS[part] ?? 0.5) / total) * 100}%"
					class="min-w-0 grow"
				>
					{#if !(r === 0 && p === 0)}
						<label for={fieldInputId(sub)} class="sr-only">{sub.label}</label>
					{/if}
					<ComboField
						field={sub}
						value={tags[sub.key ?? ""]}
						context={partContext}
						plain
						{locked}
						mixed={mixed.has(sub.key ?? "")}
						onchange={(value) =>
							onchange({
								[sub.key ?? ""]: value ? cleanValue(value) : undefined,
							})}
						onlive={(typed) => {
							if (cleanValue(typed)) onchange({ [sub.key ?? ""]: typed }, true);
						}}
					/>
				</div>
			{/each}
		</div>
	{/each}
</div>
