/**
 * The tags of several selected features as one editor shows them (iD's combined tags): the
 * values they share, and for the others each feature's own value, so a field can say "Multiple
 * values" and a list field can change each feature's list rather than overwrite it.
 */
import type { Tags } from "#lib/osm/tags.ts";
import {
	chipsOf,
	type Chip as FieldChip,
	splitSemicolons,
	type TagPatch,
} from "./combo.ts";
import type { Field, Preset } from "./presets.ts";

export interface CombinedTags {
	/** The tags every feature has, with the same value. */
	readonly tags: Tags;
	/**
	 * The keys whose values differ, or that only some features have: each feature's value, in
	 * order (undefined for a feature without the key).
	 */
	readonly mixed: ReadonlyMap<string, readonly (string | undefined)[]>;
}

export function combineTags(tagsList: readonly Tags[]): CombinedTags {
	const keys = new Set(tagsList.flatMap((tags) => Object.keys(tags)));
	const tags: Record<string, string> = {};
	const mixed = new Map<string, (string | undefined)[]>();
	for (const key of keys) {
		const values = tagsList.map((t) => t[key]);
		const [first] = values;
		if (first !== undefined && values.every((v) => v === first)) {
			tags[key] = first;
		} else {
			mixed.set(key, values);
		}
	}
	return { tags, mixed };
}

/** Whether the features have different values for `key`. */
export function isMixed(combined: CombinedTags, key: string): boolean {
	return combined.mixed.has(key);
}

export interface Chip {
	readonly value: string;
	/** Every feature's list has it (otherwise only some do). */
	readonly all: boolean;
}

/** The values of a `;` list field over the features, in the order first found. */
export function chipsIn(combined: CombinedTags, key: string): Chip[] {
	const values = combined.mixed.get(key) ?? [combined.tags[key]];
	const lists = values.map((value) => splitSemicolons(value));
	const seen = [...new Set(lists.flat())];
	return seen.map((value) => ({
		value,
		all: lists.every((list) => list.includes(value)),
	}));
}

/** A chip field's chip over several features: `all` when every feature has it. */
export type SharedChip = FieldChip & { readonly all: boolean };

/**
 * The chips of a list (`;` values) or multi-key field over several features: those every
 * feature has, and those only some have (a key without a state then: its values differ).
 */
export function chipsOver(field: Field, combined: CombinedTags): SharedChip[] {
	if (field.type === "semiCombo") {
		const key = field.key ?? "";
		const shared = chipsIn(combined, key);
		const union = { [key]: shared.map((c) => c.value).join(";") };
		return chipsOf(field, union).map((chip) => ({
			...chip,
			all: shared.find((c) => c.value === chip.value)?.all ?? true,
		}));
	}
	// Mixed keys stand in the shared tags with an empty value, which chipsOf keeps.
	const all = chipsOf(field, {
		...combined.tags,
		...Object.fromEntries([...combined.mixed.keys()].map((k) => [k, ""])),
	});
	return all.map((chip) =>
		combined.mixed.has(chip.key)
			? {
					key: chip.key,
					value: chip.value,
					label: chip.label,
					raw: chip.raw,
					all: false,
				}
			: { ...chip, all: true },
	);
}

/** The patch taking a chip off one feature's own tags (nothing if it hasn't the chip). */
export function withoutChip(
	field: Field,
	tags: Tags,
	chip: { readonly key: string; readonly value: string },
): TagPatch {
	if (field.type !== "semiCombo") {
		return tags[chip.key] === undefined ? {} : { [chip.key]: undefined };
	}
	const list = splitSemicolons(tags[chip.key]);
	if (!list.includes(chip.value)) return {};
	const rest = list.filter((v) => v !== chip.value);
	return { [chip.key]: rest.length ? rest.join(";") : undefined };
}

/** The patch turning `before` into `after`: keys changed or added, and those removed. */
export function tagDiff(before: Tags, after: Tags): TagPatch {
	const patch: TagPatch = {};
	for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
		if (before[key] !== after[key]) patch[key] = after[key];
	}
	return patch;
}

/**
 * The tags the tag editor shows for several features: the shared ones, and each mixed key with
 * an empty value (shown as "Multiple values").
 */
export function editorTags(combined: CombinedTags): Tags {
	return {
		...combined.tags,
		...Object.fromEntries([...combined.mixed.keys()].map((k) => [k, ""])),
	};
}

/**
 * The patch for every feature once the tag editor changed `editorTags(combined)` into `next`:
 * keys set or changed, and keys removed; a mixed key left empty keeps each feature's value.
 */
export function editorPatch(combined: CombinedTags, next: Tags): TagPatch {
	const before = editorTags(combined);
	const patch: TagPatch = {};
	for (const key of new Set([...Object.keys(before), ...Object.keys(next)])) {
		const value = next[key];
		if (value === before[key]) continue;
		if (value === "") continue;
		patch[key] = value;
	}
	return patch;
}

/**
 * The type several features are edited as: theirs when they share one, else one with the
 * fields every type has (iD's shared fields), named "Multiple types".
 */
export function sharedPreset(presets: readonly Preset[]): Preset | undefined {
	const [first, ...rest] = presets;
	if (!first || rest.every((p) => p.id === first.id)) return first;
	const all = (p: Preset) => new Set([...p.fields, ...p.moreFields]);
	const inEvery = (id: string) => rest.every((p) => all(p).has(id));
	const fields = first.fields.filter(
		(id) => inEvery(id) && rest.every((p) => p.fields.includes(id)),
	);
	const moreFields = [...all(first)].filter(
		(id) => inEvery(id) && !fields.includes(id),
	);
	return {
		id: "@multiple",
		name: "Multiple types",
		terms: [],
		geometry: [...new Set(presets.flatMap((p) => p.geometry))],
		tags: {},
		searchable: false,
		fields,
		moreFields,
	};
}
