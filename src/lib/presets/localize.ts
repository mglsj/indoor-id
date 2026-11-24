/**
 * Presets, fields and categories in another language (P6), from the tagging schema's own
 * translations (`generated/translations/{locale}.json`, written by scripts/build-presets.ts).
 * What a translation lacks stays English. A preset is still found by its English name and
 * terms after its own: a name seen on the wiki finds it. Pure.
 */
import type { CategoryData, Field, Preset } from "./presets.ts";

type Option =
	| string
	| { readonly title?: string; readonly description?: string };

/** One language's strings of the schema, by preset, field and category id. */
export interface SchemaTranslation {
	readonly presets?: Readonly<
		Record<
			string,
			{ name?: string; aliases?: readonly string[]; terms?: readonly string[] }
		>
	>;
	readonly fields?: Readonly<
		Record<
			string,
			{
				label?: string;
				placeholder?: string;
				terms?: readonly string[];
				options?: Readonly<Record<string, Option>>;
				types?: Readonly<Record<string, string>>;
				placeholders?: Readonly<Record<string, string>>;
			}
		>
	>;
	readonly categories?: Readonly<Record<string, string>>;
}

export function localizePresets(
	presets: readonly Preset[],
	translation: SchemaTranslation,
): Preset[] {
	return presets.map((preset) => {
		const text = translation.presets?.[preset.id];
		if (!text?.name) return preset;
		return {
			...preset,
			name: text.name,
			aliases: [...(text.aliases ?? []), ...(preset.aliases ?? [])],
			terms: [...(text.terms ?? []), preset.name, ...preset.terms],
		};
	});
}

export function localizeFields(
	fields: readonly Field[],
	translation: SchemaTranslation,
): Field[] {
	return fields.map((field) => {
		const text = translation.fields?.[field.id];
		if (!text) return field;
		return {
			...field,
			label: text.label ?? field.label,
			placeholder: text.placeholder ?? field.placeholder,
			terms: [...(text.terms ?? []), ...field.terms],
			options: field.options.map((option) => {
				const own = text.options?.[option.value];
				if (typeof own === "string") return { ...option, label: own };
				if (!own?.title) return option;
				return {
					...option,
					label: own.title,
					...(own.description ? { description: own.description } : {}),
				};
			}),
			...(field.types && text.types
				? { types: { ...field.types, ...text.types } }
				: {}),
			...(field.placeholders && text.placeholders
				? { placeholders: { ...field.placeholders, ...text.placeholders } }
				: {}),
		};
	});
}

export function localizeCategories(
	categories: readonly CategoryData[],
	translation: SchemaTranslation,
): CategoryData[] {
	return categories.map((category) => {
		const name = translation.categories?.[category.id];
		return name ? { ...category, name } : category;
	});
}
