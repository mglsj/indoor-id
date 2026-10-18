/**
 * Values of iD's combo fields (`ui/fields/combo.js`): what is typed as a tag value, a value as
 * shown, and the suggestions offered (the field's options, then taginfo's values).
 */
import type { Tags } from "#lib/osm/tags.ts";
import type { Field } from "./presets.ts";

/** Changes to tags: a value sets the key, undefined removes it. */
export type TagPatch = Record<string, string | undefined>;

/** A value offered by a combo field. */
export interface ComboSuggestion {
	/** The tag value (for a multiCombo, the key's suffix). */
	readonly value: string;
	/** What is shown: the option's label, or the value. */
	readonly label: string;
	readonly description?: string;
	/** Taginfo's description, when the field has none. */
	readonly title?: string;
	/** A value without a label of its own (shown as typed). */
	readonly raw: boolean;
}

/** A value from taginfo. */
export interface SuggestedValue {
	readonly value: string;
	readonly title: string;
}

/** `a ; b;;c` → `a;b;c`, as iD's `utilSplitAtSemicolon`. */
export function splitSemicolons(value: string | undefined): string[] {
	return (value ?? "")
		.split(";")
		.map((s) => s.trim())
		.filter(Boolean);
}

/** A value spelled as the field wants it: snake_case and lowercase unless it says otherwise. */
export function spelled(field: Field, value: string): string {
	let result = value;
	if (field.snakeCase) result = result.replace(/\s+/g, "_");
	if (
		!field.caseSensitive &&
		!(field.key === "type" && result === "associatedStreet")
	)
		result = result.toLowerCase();
	return result;
}

/** The tag value for what was typed (an option's label gives its value), or undefined. */
export function tagValue(field: Field, typed: string): string | undefined {
	const text = splitSemicolons(typed).join(";");
	const option = field.options.find(
		(o) =>
			splitSemicolons(o.label).join(";").toLowerCase() === text.toLowerCase(),
	);
	if (option) return option.value;
	if (field.type === "typeCombo" && !text) return "yes";
	return spelled(field, text) || undefined;
}

/** A tag value as shown: its option's label, or the value; a type of `yes` shows nothing. */
export function displayValue(field: Field, value: string | undefined): string {
	if (value === undefined) return "";
	const option = field.options.find((o) => o.value === value);
	if (option) return option.label;
	if (field.type === "typeCombo" && value.toLowerCase() === "yes") return "";
	return value;
}

/** Whether `search` is in `text` with a typo allowed every 5 letters (iD's combobox). */
export function fuzzyMatch(search: string, text: string): boolean {
	return (
		substringDistance(strip(search), strip(text)) <=
		Math.floor(search.length / 5)
	);
}

const strip = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "");

/** Fewest edits turning `search` into a part of `text`. */
function substringDistance(search: string, text: string): number {
	if (!search) return 0;
	let previous = Array.from({ length: search.length + 1 }, (_, j) => j);
	let best = previous[search.length] as number;
	for (let i = 1; i <= text.length; i++) {
		const row = [0];
		for (let j = 1; j <= search.length; j++) {
			row[j] =
				text[i - 1] === search[j - 1]
					? (previous[j - 1] as number)
					: 1 +
						Math.min(
							previous[j - 1] as number,
							row[j - 1] as number,
							previous[j] as number,
						);
		}
		best = Math.min(best, row[search.length] as number);
		previous = row;
	}
	return best;
}

export interface SuggestionOptions {
	/** Values already in a list (semiCombo, multiCombo), left out unless duplicates are allowed. */
	readonly chosen?: readonly string[];
	/** Deprecated values of the field's key, never suggested. */
	readonly deprecated?: readonly string[];
}

/**
 * What a combo field offers for `query`: its options, then taginfo's values (`suggested`, null
 * when not asked) that are spelled right, not deprecated, and not a type's `yes`; filtered by
 * the query in the label or the value, with typos for labelled values.
 */
export function comboSuggestions(
	field: Field,
	query: string,
	suggested: readonly SuggestedValue[] | null,
	{ chosen = [], deprecated = [] }: SuggestionOptions,
): ComboSuggestion[] {
	const isMulti = field.type === "multiCombo";
	const own: ComboSuggestion[] = field.options.map((o) => ({
		value: o.value,
		label: o.label,
		...(o.description ? { description: o.description } : {}),
		raw: false,
	}));
	const extra: ComboSuggestion[] = [];
	for (const s of suggested ?? []) {
		const value =
			isMulti && field.key ? s.value.slice(field.key.length) : s.value;
		if (field.type === "typeCombo" && value === "yes") continue;
		if (value !== spelled(field, value)) continue;
		if (deprecated.includes(s.value)) continue;
		if (own.some((o) => o.value === value)) continue;
		const title =
			s.title !== value && s.title !== s.value ? s.title : undefined;
		extra.push({ value, label: value, ...(title ? { title } : {}), raw: true });
	}
	const q = query.trim().toLowerCase();
	return [...own, ...extra].filter((s) => {
		if (!field.allowDuplicates && chosen.includes(s.value)) return false;
		const label = s.label.toLowerCase();
		const value = s.value.toLowerCase();
		if (label.includes(q) || value.includes(q)) return true;
		return !s.raw && (fuzzyMatch(q, label) || fuzzyMatch(q, value));
	});
}

/** A chip of a semiCombo, multiCombo or manyCombo. */
export interface Chip {
	/** The tag key: the field's for a semiCombo, the chip's own otherwise. */
	readonly key: string;
	/** The value in the list, or the key's suffix (`cash` of `payment:cash`). */
	readonly value: string;
	readonly label: string;
	/** A multiCombo or manyCombo key's value, lowercase (`yes`, `no`…). */
	readonly state?: string;
	readonly raw: boolean;
}

/** A multiCombo's key prefix, ending with `:` (iD adds it when missing). */
function prefix(field: Field): string {
	const key = field.key ?? "";
	return key && !key.endsWith(":") ? `${key}:` : key;
}

const isList = (field: Field) => field.type === "semiCombo";

/** The values a semiCombo's list holds, each once unless the field allows duplicates. */
function listValues(field: Field, tags: Tags): string[] {
	const values = splitSemicolons(field.key ? tags[field.key] : undefined);
	return field.allowDuplicates ? values : [...new Set(values)];
}

/** Keys a multiCombo or manyCombo has set, in the tags' order. */
function chipKeys(field: Field, tags: Tags): string[] {
	const start = prefix(field);
	return Object.keys(tags).filter((key) =>
		start ? key.startsWith(start) && key !== start : field.keys?.includes(key),
	);
}

/** The chips a list or multi-key field shows. */
export function chipsOf(field: Field, tags: Tags): Chip[] {
	const chip = (key: string, value: string, state?: string): Chip => {
		const option = field.options.find((o) => o.value === value);
		return {
			key,
			value,
			label: option?.label ?? value,
			...(state !== undefined ? { state } : {}),
			raw: !option,
		};
	};
	if (isList(field)) {
		return listValues(field, tags).map((v) => chip(field.key ?? "", v));
	}
	const start = prefix(field);
	return chipKeys(field, tags).map((key) =>
		chip(key, key.slice(start.length), tags[key]?.toLowerCase()),
	);
}

/** Tags adding what was typed: to the end of a list, or as keys set to `yes`. */
export function addChips(field: Field, tags: Tags, typed: string): TagPatch {
	const values = typed
		.split(/[;,]/)
		.map((part) => tagValue({ ...field, type: "combo" }, part))
		.filter((v): v is string => v !== undefined);
	if (values.length === 0) return {};
	if (isList(field)) {
		if (!field.key) return {};
		const all = [...listValues(field, tags), ...values];
		const list = field.allowDuplicates ? all : [...new Set(all)];
		return { [field.key]: list.join(";") };
	}
	const patch: TagPatch = {};
	for (const value of values) {
		const key = `${prefix(field)}${value}`;
		const old = tags[key];
		// `language:de=main` stays: only an unset or `no` key becomes yes.
		if (old !== undefined && old.toLowerCase() !== "no") continue;
		patch[key] = "yes";
	}
	return patch;
}

/** Tags without the chip at `index`. */
export function removeChip(field: Field, tags: Tags, index: number): TagPatch {
	if (isList(field)) {
		if (!field.key) return {};
		const list = listValues(field, tags).filter((_, i) => i !== index);
		return { [field.key]: list.length ? list.join(";") : undefined };
	}
	const key = chipKeys(field, tags)[index];
	return key ? { [key]: undefined } : {};
}

/** A multi-key chip switched between yes and no (any other value becomes yes). */
export function toggleChip(tags: Tags, key: string): TagPatch {
	return { [key]: tags[key] === "yes" ? "no" : "yes" };
}

/** A list with the chip at `from` moved to `to`. */
export function moveChip(
	field: Field,
	tags: Tags,
	from: number,
	to: number,
): TagPatch {
	if (!field.key) return {};
	const list = listValues(field, tags);
	const [moved] = list.splice(from, 1);
	if (moved === undefined) return {};
	list.splice(to, 0, moved);
	return { [field.key]: list.join(";") };
}
