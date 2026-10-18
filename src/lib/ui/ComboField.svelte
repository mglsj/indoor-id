<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import { tick } from "svelte";
	import { msg, t } from "#lib/i18n/messages.ts";
	import {
		type ComboSuggestion,
		comboSuggestions,
		displayValue,
		type SuggestedValue,
		tagValue,
	} from "#lib/presets/combo.ts";
	import type { Field } from "#lib/presets/presets.ts";
	import ComboList from "#lib/ui/ComboList.svelte";
	import { Combobox } from "#lib/ui/combobox.svelte.ts";
	import { type FieldContext, fieldInputId } from "#lib/ui/field-context.ts";
	import { cn } from "#lib/utils.ts";

	interface Props {
		field: Field;
		/** The tag value (combo, typeCombo, networkCombo). */
		value: string | undefined;
		context: FieldContext;
		locked: boolean;
		/** Called with the new value once accepted (Enter, Tab, a click, leaving the field). */
		onchange?: (value: string | undefined) => void;
		/**
		 * The input of a chip list instead: what is accepted goes to `onadd` (as typed) and the
		 * input empties; values in `chosen` aren't offered again.
		 */
		adding?: {
			readonly chosen: readonly string[];
			readonly onadd: (typed: string) => void;
		};
		/** Free text (an address), never shown as a raw tag value. */
		plain?: boolean;
		/**
		 * Text kept as typed (only trimmed), suggestions asked for without a key: the tag
		 * table's key and value inputs. Implies `plain`.
		 */
		raw?: boolean;
		/** The input's name when no label points at it. */
		ariaLabel?: string;
		/**
		 * Text applied while it is typed (an address part, as iD), without the completion
		 * offered after it; leaving the field then calls `onchange`, even with the same text.
		 */
		onlive?: (typed: string) => void;
		/**
		 * The features edited have different values: the input starts empty, saying so, and
		 * nothing changes unless something is typed or chosen.
		 */
		mixed?: boolean;
	}

	let {
		field,
		value,
		context,
		locked,
		onchange,
		adding,
		plain: plainProp = false,
		raw = false,
		ariaLabel,
		onlive,
		mixed = false,
	}: Props = $props();

	const id = $derived(fieldInputId(field));
	const listId = $derived(`${id}-list`);
	const readonly = $derived(locked || !field.customValues);

	let input = $state<HTMLInputElement>();
	let wrap = $state<HTMLDivElement>();
	/** What the suggestions are for: the text typed, or "" for all of them. */
	let query = $state("");
	/** Taginfo's values, as last asked. */
	const combo = new Combobox<readonly SuggestedValue[]>({
		search: (q) => context.suggest?.(field, q) ?? [],
		onresult: () => {
			if (combo.open) autocomplete();
		},
	});
	/** Whether the user typed or chose something since the field got focus. */
	let dirty = false;

	$effect(() => () => combo.dispose());

	const suggestions = $derived(
		comboSuggestions(field, query, combo.result, {
			deprecated: field.key ? context.deprecated(field.key) : [],
			chosen: adding?.chosen ?? [],
		}),
	);
	const plain = $derived(plainProp || raw);
	const shown = $derived(
		adding || mixed ? "" : raw ? (value ?? "") : displayValue(field, value),
	);
	/** iD asks taginfo for every combo but manyCombo, unless the field says not to. */
	const asksTaginfo = $derived(
		context.suggest !== undefined &&
			field.autoSuggestions &&
			field.type !== "manyCombo" &&
			(raw || field.key !== undefined),
	);
	const hasList = $derived(
		!locked && (field.options.length > 0 || asksTaginfo),
	);

	/** Asks taginfo for values matching `q`, after a pause while typing (as iD). */
	function fetchValues(q: string) {
		if (asksTaginfo) combo.find(q);
	}

	/** The text typed, without the completion selected after it. */
	function typed(): string {
		if (!input) return "";
		const { value: text, selectionStart, selectionEnd } = input;
		return selectionStart && selectionEnd && selectionStart !== selectionEnd
			? text.slice(0, selectionStart)
			: text;
	}

	/** iD's inline completion: the first suggestion starting with what was typed, the rest selected. */
	function autocomplete() {
		if (!input || document.activeElement !== input || readonly) return;
		if (input.selectionEnd !== input.value.length) return;
		const text = typed();
		const compare = (s: string) => (field.caseSensitive ? s : s.toLowerCase());
		const wanted = compare(text);
		if (!wanted || Number.isFinite(Number(wanted))) return;
		const candidates = suggestions.flatMap((s) =>
			s.label !== s.value ? [s.label, s.value] : [s.label],
		);
		const best =
			candidates.find((c) => compare(c) === wanted) ??
			candidates.find((c) => compare(c).startsWith(wanted));
		if (best === undefined) return;
		input.value = best;
		input.setSelectionRange(text.length, best.length, "backward");
		combo.highlighted = suggestions.findIndex(
			(s) => s.label === best || s.value === best,
		);
	}

	/** Whether text was applied while typing since the field got focus. */
	let appliedLive = false;

	async function oninput(event: Event) {
		if (!input) return;
		dirty = true;
		const text = input.value;
		query = text;
		combo.highlighted = -1;
		combo.open = text !== "";
		fetchValues(text);
		if (onlive && !adding) {
			appliedLive = true;
			onlive(text);
			// Once the value applied is drawn back into the input, which drops a completion.
			await tick();
		}
		const { inputType, isComposing } = event as InputEvent;
		if (!inputType?.startsWith("delete") && !isComposing) autocomplete();
	}

	function onfocus() {
		dirty = false;
		query = "";
		fetchValues("");
	}

	function commit() {
		if (!input || !dirty) return;
		dirty = false;
		const closesLive = appliedLive;
		appliedLive = false;
		if (adding) {
			const text = input.value.trim();
			input.value = "";
			query = "";
			if (text) adding.onadd(text);
			return;
		}
		const next = raw
			? input.value.trim() || undefined
			: tagValue(field, input.value);
		input.value = raw ? (next ?? "") : displayValue(field, next);
		if (next !== value || closesLive) onchange?.(next);
	}

	function accept() {
		combo.open = false;
		if (input) input.setSelectionRange(input.value.length, input.value.length);
		commit();
	}

	function choose(suggestion: ComboSuggestion) {
		if (!input) return;
		input.value = suggestion.label;
		dirty = true;
		accept();
	}

	function showAll() {
		if (locked) return;
		input?.focus();
		query = "";
		combo.highlighted = suggestions.findIndex((s) => s.value === value);
		combo.open = !combo.open;
	}

	function move(step: number) {
		if (!input) return;
		// Opened even before taginfo answers: the list shows once it does (as iD).
		if (!combo.open && !input.value) query = "";
		const from =
			combo.highlighted >= 0
				? combo.highlighted
				: suggestions.findIndex(
						(s) => s.label === input?.value || s.value === input?.value,
					);
		const highlighted = combo.move(step, suggestions.length, from);
		const suggestion = suggestions[highlighted];
		if (!suggestion) return;
		input.value = suggestion.label;
		dirty = true;
	}

	function onkeydown(event: KeyboardEvent) {
		switch (event.key) {
			case "ArrowDown":
			case "ArrowUp":
				if (locked) return;
				event.preventDefault();
				move(event.key === "ArrowDown" ? 1 : -1);
				break;
			case "Enter":
				event.preventDefault();
				event.stopPropagation();
				accept();
				break;
			case "Tab":
				accept();
				break;
			case "Escape":
				if (combo.escape()) event.stopPropagation();
				break;
			case "Backspace":
			case "Delete":
				// A fixed list's value can't be typed over: these keys take it off (as iD).
				if (readonly && !locked && !adding && value !== undefined) {
					event.preventDefault();
					combo.open = false;
					onchange?.(undefined);
				}
				break;
		}
	}

	const tagText = (v: string) => (field.key && !raw ? `${field.key}=${v}` : v);
</script>

<div bind:this={wrap} class="relative">
	<input
		bind:this={input}
		{id}
		type="text"
		role="combobox"
		autocomplete="off"
		spellcheck="false"
		aria-autocomplete="both"
		aria-label={ariaLabel}
		aria-expanded={combo.open && suggestions.length > 0}
		aria-controls={listId}
		aria-activedescendant={combo.open && combo.highlighted >= 0
			? `${listId}-${combo.highlighted}`
			: undefined}
		value={shown}
		placeholder={(mixed ? t(msg("field_multiple_values")) : undefined) ??
			field.placeholder ??
			(adding ? "Add…" : undefined) ??
			suggestions
				.slice(0, 3)
				.map((s) => s.label)
				.join(", ") + (suggestions.length ? "…" : "")}
		title={value ? tagText(value) : undefined}
		{readonly}
		class={cn(
			"flex h-8 w-full min-w-0 rounded-lg border border-input bg-transparent py-1 pl-2.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
			raw ? "pr-2.5" : "pr-8",
			!plain &&
				value !== undefined &&
				!field.options.some((o) => o.value === value) &&
				"font-mono text-xs",
		)}
		{oninput}
		{onfocus}
		{onkeydown}
		onclick={() => {
			if (readonly) showAll();
		}}
		onblur={() => {
			combo.open = false;
			commit();
		}}
	>
	<!-- No caret in the tag table, as iD: ↓ opens the list. -->
	{#if hasList && !raw}
		<button
			type="button"
			tabindex="-1"
			aria-label={`Show values for ${field.label}`}
			class="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground hover:text-foreground"
			onmousedown={(event) => event.preventDefault()}
			onclick={showAll}
		>
			<ChevronDown class="size-4" />
		</button>
	{/if}
</div>

<ComboList
	id={listId}
	label={field.label}
	options={suggestions.map((suggestion) => ({
		key: suggestion.value,
		label: suggestion.label,
		description: suggestion.description,
		title: [
			suggestion.description ?? suggestion.title,
			tagText(suggestion.value),
		]
			.filter(Boolean)
			.join("\n"),
		mono: !plain && suggestion.raw,
	}))}
	{combo}
	anchor={wrap}
	onchoose={(i) => {
		const suggestion = suggestions[i];
		if (suggestion) choose(suggestion);
	}}
/>
