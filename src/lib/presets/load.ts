/** Loads the generated preset data (see scripts/build-presets.ts) on first use. */
import type { UpgradeRule } from "#lib/validation/upgrades.ts";
import {
	type CategoryData,
	type Field,
	type Preset,
	PresetIndex,
} from "./presets.ts";

let loading: Promise<PresetIndex> | undefined;

export function loadPresetIndex(): Promise<PresetIndex> {
	loading ??= Promise.all([
		import("./generated/presets.json"),
		import("./generated/fields.json"),
		import("./generated/categories.json"),
	]).then(
		([presets, fields, categories]) =>
			new PresetIndex(
				presets.default as unknown as Preset[],
				fields.default as unknown as Field[],
				categories.default as unknown as CategoryData[],
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
