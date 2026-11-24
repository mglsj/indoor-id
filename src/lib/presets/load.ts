/**
 * Loads the generated preset data (see scripts/build-presets.ts) on first use, in the language
 * messages are shown in (P6): the schema's translation is its own chunk, loaded only for it.
 */
import { currentLanguage } from "#lib/i18n/messages.ts";
import type { UpgradeRule } from "#lib/validation/upgrades.ts";
import {
	localizeCategories,
	localizeFields,
	localizePresets,
	type SchemaTranslation,
} from "./localize.ts";
import {
	type CategoryData,
	type Field,
	type Preset,
	PresetIndex,
} from "./presets.ts";

const TRANSLATIONS = import.meta.glob<SchemaTranslation>(
	"./generated/translations/*.json",
	{ import: "default" },
);

let loading: Promise<PresetIndex> | undefined;

async function translation(): Promise<SchemaTranslation> {
	const load =
		TRANSLATIONS[`./generated/translations/${currentLanguage()}.json`];
	try {
		return load ? await load() : {};
	} catch {
		return {};
	}
}

export function loadPresetIndex(): Promise<PresetIndex> {
	loading ??= Promise.all([
		import("./generated/presets.json"),
		import("./generated/fields.json"),
		import("./generated/categories.json"),
		translation(),
	]).then(
		([presets, fields, categories, text]) =>
			new PresetIndex(
				localizePresets(presets.default as unknown as Preset[], text),
				localizeFields(fields.default as unknown as Field[], text),
				localizeCategories(
					categories.default as unknown as CategoryData[],
					text,
				),
			),
	);
	return loading;
}

/** Tag upgrades from the schema's deprecated-tag list. */
export async function loadSchemaUpgrades(): Promise<UpgradeRule[]> {
	const { default: rules } = await import("./generated/deprecated.json");
	return rules as unknown as UpgradeRule[];
}

/** Keys never suggested in the tag table (iD's discarded tags: `created_by`…). */
export async function loadDiscardedKeys(): Promise<string[]> {
	const { default: keys } = await import("./generated/discarded.json");
	return keys as unknown as string[];
}
