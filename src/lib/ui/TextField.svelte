<script lang="ts">
	import CalendarDays from "@lucide/svelte/icons/calendar-days";
	import ExternalLink from "@lucide/svelte/icons/external-link";
	import Minus from "@lucide/svelte/icons/minus";
	import Pencil from "@lucide/svelte/icons/pencil";
	import Plus from "@lucide/svelte/icons/plus";
	import RotateCw from "@lucide/svelte/icons/rotate-cw";
	import type { Snippet } from "svelte";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as InputGroup from "#lib/components/shadcn/input-group/index.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import type { Tags } from "#lib/osm/tags.ts";
	import type { Field } from "#lib/presets/presets.ts";
	import {
		canStep,
		cleanValue,
		externalLink,
		isDateLike,
		numberValue,
		stepNumber,
		textPatch,
		textValue,
	} from "#lib/presets/text.ts";
	import {
		fieldInputId,
		type MixedValues,
		NOT_MIXED,
		type TagPatch,
	} from "#lib/ui/field-context.ts";
	import LengthIndicator from "#lib/ui/LengthIndicator.svelte";

	interface Props {
		/** text, tel, email, url, identifier, schedule, date, colour, number or integer. */
		field: Field;
		tags: Tags;
		/** Keys whose values differ between the features edited. */
		mixed?: MixedValues;
		locked: boolean;
		/** A change; `live` while typing (kept as typed, one undo step with the final value). */
		onchange: (patch: TagPatch, live?: boolean) => void;
		/** More buttons at the end of the input (a localized field's "Add translation"). */
		extra?: Snippet;
	}

	let {
		field,
		tags,
		mixed = NOT_MIXED,
		locked,
		onchange,
		extra,
	}: Props = $props();

	const id = $derived(fieldInputId(field));
	const current = $derived(textValue(field, tags, mixed));
	const isNumber = $derived(
		field.type === "number" || field.type === "integer",
	);
	/** What is in the input, as typed (for the length indicator and the buttons). */
	let typed = $derived(current.value);
	const link = $derived(externalLink(field, typed));

	let input = $state<HTMLInputElement | null>(null);
	let picker = $state<HTMLInputElement>();

	/** Whether text was applied while typing: leaving the field then ends that undo step. */
	let appliedLive = false;

	/** Each keystroke applied as typed, as iD; an emptied field waits until it is left. */
	function applyTyped(text: string) {
		if (locked || current.mixed || !cleanValue(text)) return;
		appliedLive = true;
		onchange(textPatch(field, tags, text), true);
	}

	function commit(text: string) {
		appliedLive = false;
		let value = cleanValue(text);
		if (isNumber) value = numberValue(field, value);
		// Mixed values aren't replaced by an empty field.
		if (!value && current.mixed) return;
		typed = value;
		if (input) input.value = value;
		// Even unchanged: leaving the field ends the undo step typing made (the editor makes
		// no step for tags left as they were).
		onchange(textPatch(field, tags, value));
	}

	/** The link button's name: where it goes. */
	const linkLabel = $derived.by(() => {
		if (field.type === "schedule") return "Edit in YoHours";
		if (field.type === "url") return "Visit website";
		const domain = field.urlFormat?.match(/^https?:\/\/(.+?)\//)?.[1];
		return domain ? `View on ${domain}` : "Open link";
	});

	/** A colour the browser can show, as OSM allows them (hex or a name). */
	const colour = $derived(
		field.type === "colour" &&
			/^(#([0-9a-fA-F]{3}){1,2}|\w+)$/.test(typed) &&
			!["unset", "inherit", "initial", "revert"].includes(typed) &&
			CSS.supports("color", typed)
			? typed
			: null,
	);
	/** `#abc` as the colour picker wants it (`#aabbcc`); black for names. */
	const pickerColour = $derived(
		colour?.match(/^#[0-9a-f]{6}$/i)
			? colour
			: colour?.match(/^#[0-9a-f]{3}$/i)
				? `#${[...colour.slice(1)].map((c) => c + c).join("")}`
				: "#000000",
	);

	const today = () => {
		const now = new Date();
		return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
			.toISOString()
			.slice(0, 10);
	};
	/** Survey dates get a button setting them to today (as iD). */
	const isSurveyDate = $derived(
		field.type === "date" &&
			(field.key === "check_date" || field.key === "survey:date"),
	);
</script>

<InputGroup.Root data-disabled={locked}>
	<InputGroup.Input
		bind:ref={input}
		{id}
		type={field.type === "email" || field.type === "tel" ? field.type : "text"}
		inputmode={isNumber
			? field.type === "integer"
				? "numeric"
				: "decimal"
			: undefined}
		dir="auto"
		autocomplete="off"
		value={current.value}
		placeholder={current.mixed
			? t(msg("field_multiple_values"))
			: (field.placeholder ?? "Unknown")}
		title={field.key && current.value
			? `${field.key}=${current.value}`
			: undefined}
		readonly={locked}
		oninput={(event) => {
			typed = event.currentTarget.value;
			applyTyped(typed);
		}}
		onchange={(event) => commit(event.currentTarget.value)}
		onblur={(event) => {
			// No change event for text typed back as it was: still the end of the edit.
			if (appliedLive) commit(event.currentTarget.value);
		}}
	/>
	<InputGroup.Addon align="inline-end">
		<LengthIndicator value={typed} />
		{#if isNumber}
			{@const increment = field.increment ?? 1}
			{@const disabled = locked || current.mixed || !canStep(field, typed)}
			<InputGroup.Button
				size="icon-xs"
				aria-label={`Decrease ${field.label}`}
				{disabled}
				onclick={() => commit(stepNumber(field, typed, -increment))}
			>
				<Minus />
			</InputGroup.Button>
			<InputGroup.Button
				size="icon-xs"
				aria-label={`Increase ${field.label}`}
				{disabled}
				onclick={() => commit(stepNumber(field, typed, increment))}
			>
				<Plus />
			</InputGroup.Button>
		{:else if field.type === "url" ||
			field.type === "schedule" ||
			(field.type === "identifier" && field.urlFormat && field.pattern)}
			{#if link}
				<Button
					variant="ghost"
					size="icon-xs"
					href={link}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={linkLabel}
					title={linkLabel}
				>
					<ExternalLink />
				</Button>
			{:else}
				<InputGroup.Button size="icon-xs" aria-label={linkLabel} disabled>
					<ExternalLink />
				</InputGroup.Button>
			{/if}
		{:else if field.type === "colour" && (colour || !typed)}
			<InputGroup.Button
				size="icon-xs"
				aria-label="Choose a colour"
				title="Choose a colour"
				disabled={locked}
				onclick={() => picker?.showPicker()}
			>
				{#if colour}
					<span
						class="size-4 rounded-sm border"
						style:background-color={colour}
					></span>
				{:else}
					<Pencil />
				{/if}
			</InputGroup.Button>
			<input
				bind:this={picker}
				type="color"
				tabindex="-1"
				aria-hidden="true"
				class="sr-only"
				value={pickerColour}
				onchange={(event) => commit(event.currentTarget.value)}
			>
		{:else if field.type === "date"}
			{#if isSurveyDate && typed !== today()}
				<InputGroup.Button
					size="icon-xs"
					aria-label="Set to today"
					title="Set to today"
					disabled={locked}
					onclick={() => commit(today())}
				>
					<RotateCw />
				</InputGroup.Button>
			{/if}
			{#if !typed || isDateLike(typed)}
				<InputGroup.Button
					size="icon-xs"
					aria-label="Choose a date"
					title="Choose a date"
					disabled={locked}
					onclick={() => picker?.showPicker()}
				>
					<CalendarDays />
				</InputGroup.Button>
				<input
					bind:this={picker}
					type="date"
					tabindex="-1"
					aria-hidden="true"
					class="sr-only"
					value={typed}
					onchange={(event) => {
						if (isDateLike(event.currentTarget.value))
							commit(event.currentTarget.value);
					}}
				>
			{/if}
		{/if}
		{@render extra?.()}
	</InputGroup.Addon>
</InputGroup.Root>
