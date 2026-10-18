<script lang="ts">
	import X from "@lucide/svelte/icons/x";
	import { tick } from "svelte";
	import { Checkbox } from "#lib/components/shadcn/checkbox/index.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import type { Tags } from "#lib/osm/tags.ts";
	import { addChips, moveChip, toggleChip } from "#lib/presets/combo.ts";
	import { chipsOver, withoutChip } from "#lib/presets/multi.ts";
	import type { Field } from "#lib/presets/presets.ts";
	import ComboField from "#lib/ui/ComboField.svelte";
	import {
		type FieldChange,
		type FieldContext,
		fieldInputId,
		type MixedValues,
		NOT_MIXED,
	} from "#lib/ui/field-context.ts";

	interface Props {
		/** A semiCombo (a `;` list), multiCombo (`key:value=yes`) or manyCombo (`value=yes`). */
		field: Field;
		tags: Tags;
		/** Keys whose values differ between the features edited. */
		mixed?: MixedValues;
		context: FieldContext;
		locked: boolean;
		/** Changes are made from each feature's own tags: no feature's list is overwritten. */
		onchange: (change: FieldChange) => void;
	}

	let {
		field,
		tags,
		mixed = NOT_MIXED,
		context,
		locked,
		onchange,
	}: Props = $props();

	const id = $derived(fieldInputId(field));
	const chips = $derived(chipsOver(field, { tags, mixed }));
	/** Only a list has an order; keys are switched yes/no instead. */
	const isList = $derived(field.type === "semiCombo");
	/** The features' lists differ: they have no common order to change. */
	const ordered = $derived(
		isList && !locked && !(field.key && mixed.has(field.key)),
	);
	/** A field with a fixed set of values hides its input once they are all chosen (as iD). */
	const canAdd = $derived(
		!locked &&
			(field.customValues ||
				field.options.some((o) => !chips.some((c) => c.value === o.value))),
	);

	let dragged = $state<number | null>(null);
	let target = $state<number | null>(null);

	async function move(from: number, to: number) {
		if (to < 0 || to >= chips.length || to === from) return;
		onchange((own) => moveChip(field, own, from, to));
		await tick();
		document.getElementById(`${id}-chip-${to}`)?.focus();
	}

	/** Alt+← and Alt+→ move a chip of a list, as the floor plan list does. */
	function onkeydown(event: KeyboardEvent, index: number) {
		if (!ordered || !event.altKey) return;
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		void move(index, index + (event.key === "ArrowLeft" ? -1 : 1));
	}

	function ondrop(event: DragEvent, index: number) {
		event.preventDefault();
		if (dragged !== null) void move(dragged, index);
		dragged = target = null;
	}
</script>

<div class="flex flex-col gap-1.5">
	{#if chips.length > 0}
		<ul aria-label={field.label} class="flex flex-wrap gap-1">
			{#each chips as chip, i (chip.key + chip.value)}
				<li
					draggable={ordered}
					title={[
						chip.state && !["yes", "no"].includes(chip.state) ? chip.state : "",
						isList
							? `${field.key}=${chip.value}`
							: `${chip.key}=${chip.state ?? ""}`,
						chip.all ? "" : t(msg("field_some_features")),
					]
						.filter(Boolean)
						.join("\n")}
					class={[
						"flex h-7 items-center gap-1.5 rounded-md border bg-muted/50 pr-0.5 pl-2 text-sm",
						!chip.all && "border-dashed text-muted-foreground",
						ordered && "cursor-grab",
						dragged === i && "opacity-50",
						target === i && dragged !== i && "ring-2 ring-ring/50",
					]}
					ondragstart={(event) => {
						dragged = i;
						event.dataTransfer?.setData("text/plain", chip.value);
						if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
					}}
					ondragover={(event) => {
						if (dragged === null) return;
						event.preventDefault();
						target = i;
					}}
					ondragleave={() => {
						if (target === i) target = null;
					}}
					ondrop={(event) => ondrop(event, i)}
					ondragend={() => (dragged = target = null)}
				>
					{#if !isList}
						<Checkbox
							checked={chip.state === "yes"}
							indeterminate={chip.state !== "yes" && chip.state !== "no"}
							disabled={locked}
							aria-label={chip.label}
							onCheckedChange={() =>
								onchange(
									chip.all ? toggleChip(tags, chip.key) : { [chip.key]: "yes" },
								)}
						/>
					{/if}
					<span
						class={[
							"truncate",
							chip.raw && "font-mono text-xs",
							chip.state === "no" && "text-muted-foreground line-through",
						]}
						>{chip.label}</span
					>
					{#if !locked}
						<button
							type="button"
							id={`${id}-chip-${i}`}
							aria-label={`Remove ${chip.label}`}
							title={ordered ? "Remove (Alt+← Alt+→ to move)" : "Remove"}
							class="flex size-6 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
							onclick={() => onchange((own) => withoutChip(field, own, chip))}
							onkeydown={(event) => onkeydown(event, i)}
						>
							<X class="size-3.5" />
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	{#if canAdd}
		<ComboField
			{field}
			value={undefined}
			{context}
			{locked}
			adding={{
				chosen: chips.map((c) => c.value),
				onadd: (typed) => onchange((own) => addChips(field, own, typed)),
			}}
		/>
	{/if}
</div>
