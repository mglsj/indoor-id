<script lang="ts">
	import { Input } from "#lib/components/shadcn/input/index.ts";
	import * as RadioGroup from "#lib/components/shadcn/radio-group/index.ts";
	import type { Tags } from "#lib/osm/tags.ts";
	import {
		radioChoice,
		radioOptions,
		radioPatch,
		structureTypePatch,
	} from "#lib/presets/choice.ts";
	import type { Field } from "#lib/presets/presets.ts";
	import ComboField from "#lib/ui/ComboField.svelte";
	import {
		type FieldContext,
		fieldInputId,
		type TagPatch,
	} from "#lib/ui/field-context.ts";

	interface Props {
		/** A radio or structureRadio field. */
		field: Field;
		tags: Tags;
		context: FieldContext;
		locked: boolean;
		onchange: (patch: TagPatch) => void;
	}

	let { field, tags, context, locked, onchange }: Props = $props();

	const id = $derived(fieldInputId(field));
	const options = $derived(radioOptions(field, tags));
	const choice = $derived(radioChoice(field, tags));
	const isStructure = $derived(field.type === "structureRadio");
	/** The type field of the structure chosen (`bridge`: viaduct, boardwalk…). */
	const typeField = $derived(
		isStructure && choice ? context.field?.(choice) : undefined,
	);
	const showLayer = $derived(
		isStructure &&
			(choice === "bridge" || choice === "tunnel" || tags.layer !== undefined),
	);

	/** Values a key-less radio's keys had, given back when chosen again (as iD). */
	const remembered: Record<string, string> = {};

	function choose(next: string) {
		if (next === choice) return;
		if (choice && tags[choice]) remembered[choice] = tags[choice];
		// Water goes through culverts and over aqueducts.
		if (isStructure && tags.waterway) {
			remembered.tunnel ??= "culvert";
			remembered.bridge ??= "aqueduct";
		}
		onchange(radioPatch(field, tags, next, remembered));
	}
</script>

<RadioGroup.Root
	{id}
	aria-label={field.label}
	disabled={locked}
	bind:value={() => choice ?? "", choose}
	class="grid grid-cols-2 gap-x-3 gap-y-2"
>
	{#each options as option (option.value)}
		{@const itemId = `${id}-${option.value}`}
		<div
			class="flex items-center gap-2"
			title={[
				option.description,
				field.key ? `${field.key}=${option.value}` : "",
			]
				.filter(Boolean)
				.join("\n")}
		>
			<RadioGroup.Item id={itemId} value={option.value} />
			<label
				for={itemId}
				class={[
					"text-sm",
					!field.options.some((o) => o.value === option.value) &&
						"font-mono text-xs",
				]}
				>{option.label}</label
			>
		</div>
	{/each}
</RadioGroup.Root>

{#if isStructure && choice}
	<div class="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
		{#if typeField}
			<label for={fieldInputId(typeField)} class="text-sm text-muted-foreground"
				>Type</label
			>
			<ComboField
				field={typeField}
				value={tags[choice]}
				{context}
				{locked}
				onchange={(value) => onchange(structureTypePatch(tags, choice, value))}
			/>
		{/if}
		{#if showLayer}
			<label for={`${id}-layer`} class="text-sm text-muted-foreground"
				>Layer</label
			>
			<Input
				id={`${id}-layer`}
				inputmode="numeric"
				value={tags.layer ?? ""}
				readonly={locked}
				onchange={(event) =>
					onchange({ layer: event.currentTarget.value.trim() || undefined })}
			/>
		{/if}
	</div>
{/if}
