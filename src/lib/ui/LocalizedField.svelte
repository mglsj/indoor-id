<script lang="ts">
	import Languages from "@lucide/svelte/icons/languages";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import { Input } from "#lib/components/shadcn/input/index.ts";
	import * as InputGroup from "#lib/components/shadcn/input-group/index.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import type { Tags } from "#lib/osm/tags.ts";
	import {
		languageCode,
		languageName,
		languageOptions,
		translationPatch,
		translations,
	} from "#lib/presets/localized.ts";
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
	import TextField from "#lib/ui/TextField.svelte";

	interface Props {
		/** A localized field: `name`, with `name:<lang>` rows. */
		field: Field;
		tags: Tags;
		/** Keys whose values differ between the features edited (the name, translations). */
		mixed?: MixedValues;
		locked: boolean;
		/** A change; `live` while typing (kept as typed, one undo step with the final value). */
		onchange: (patch: TagPatch, live?: boolean) => void;
	}

	let { field, tags, mixed = NOT_MIXED, locked, onchange }: Props = $props();

	/** Rows added and not saved yet (no language or no value), shown first as in iD. */
	let pending = $state<{ id: number; lang: string; value: string }[]>([]);
	let nextId = 0;
	/** Translations, those whose values differ included (shown empty). */
	const saved = $derived(
		translations(field, {
			...tags,
			...Object.fromEntries(
				[...mixed.keys()]
					.filter((key) => key.startsWith(`${field.key}:`))
					.map((key) => [key, ""]),
			),
		}),
	);
	const isMixed = (lang: string) => mixed.has(`${field.key}:${lang}`);
	const noContext: FieldContext = { deprecated: () => [] };

	/** A language input, offering languages by English name with their own name. */
	const languageField = (row: string): Field => ({
		id: `${field.id}-lang-${row}`,
		type: "combo",
		label: "Language",
		placeholder: "Language",
		options: languageOptions().map((l) => ({
			value: l.code,
			label: l.label,
			...(l.native ? { description: l.native } : {}),
		})),
		terms: [],
		universal: false,
		snakeCase: false,
		caseSensitive: false,
		customValues: true,
		autoSuggestions: false,
		allowDuplicates: false,
	});

	function add() {
		if (locked || pending.some((p) => !p.lang)) return;
		pending = [{ id: nextId++, lang: "", value: "" }, ...pending];
	}

	/** Saves a pending row once it has both a language and a value. */
	function settle(row: { id: number; lang: string; value: string }) {
		if (!row.lang || !row.value) return;
		pending = pending.filter((p) => p.id !== row.id);
		onchange(translationPatch(field, undefined, row.lang, row.value));
	}
</script>

{#snippet addButton()}
	<InputGroup.Button
		size="icon-xs"
		aria-label="Add a translation"
		title="Add a translation"
		disabled={locked}
		onclick={add}
	>
		<Languages />
	</InputGroup.Button>
{/snippet}

<div class="flex flex-col gap-2">
	<TextField {field} {tags} {mixed} {locked} {onchange} extra={addButton} />

	{#each pending as row (row.id)}
		{@const lang = languageField(`new-${row.id}`)}
		{@render translation(
			lang,
			row.lang,
			row.value,
			false,
			(code) => {
				row.lang = code;
				settle(row);
			},
			(value) => {
				row.value = value;
				settle(row);
			},
			() => (pending = pending.filter((p) => p.id !== row.id)),
		)}
	{/each}
	{#each saved as row (row.lang)}
		{@render translation(
			languageField(row.lang),
			row.lang,
			row.value,
			isMixed(row.lang),
			(code) => onchange(translationPatch(field, row.lang, code, row.value)),
			(value) => onchange(translationPatch(field, row.lang, row.lang, value)),
			() => onchange({ [`${field.key}:${row.lang}`]: undefined }),
		)}
	{/each}
</div>

{#snippet translation(
	langField: Field,
	lang: string,
	value: string,
	/** The features' values differ: shown empty, its language kept. */
	rowMixed: boolean,
	onlang: (code: string) => void,
	onvalue: (value: string) => void,
	onremove: () => void,
)}
	<div
		class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-1.5"
	>
		<label for={fieldInputId(langField)} class="sr-only">Language</label>
		<ComboField
			field={langField}
			value={lang || undefined}
			context={noContext}
			locked={locked || rowMixed}
			onchange={(typed) => {
				const code = typed ? languageCode(typed) : "";
				if (code && code !== lang) onlang(code);
			}}
		/>
		<Input
			{value}
			dir="auto"
			lang={lang || undefined}
			aria-label={lang
				? `${field.label} in ${languageName(lang)}`
				: "Translated name"}
			placeholder={rowMixed
				? t(msg("field_multiple_values"))
				: "Translated name"}
			readonly={locked}
			onchange={(event) => onvalue(cleanValue(event.currentTarget.value))}
		/>
		<Button
			variant="ghost"
			size="icon-xs"
			aria-label={lang
				? `Remove the ${languageName(lang)} name`
				: "Remove translation"}
			class="text-muted-foreground hover:text-destructive"
			disabled={locked}
			onclick={onremove}
		>
			<Trash2 />
		</Button>
	</div>
{/snippet}
