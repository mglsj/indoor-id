/**
 * Which fields the feature editor shows, after iD's Fields section (`ui/sections/preset_fields.js`,
 * `ui/form_fields.js`, `ui/field.js`), and the label row's remove and revert.
 */
import type { Tags } from "#lib/osm/tags.ts";
import type {
	Field,
	PrerequisiteTag,
	Preset,
	PresetGeometry,
	PresetIndex,
} from "./presets.ts";

export interface FieldList {
	/** Fields drawn in the section, in order. */
	readonly shown: readonly Field[];
	/** Fields offered by "Add field", in order. */
	readonly addable: readonly Field[];
}

/**
 * The fields of a feature: its preset's fields for the geometry, then its preset's more fields and
 * the universal ones, by label, once they have a value or were `added`; the rest of those go to
 * "Add field", universal ones last. A field waits for its `prerequisiteTag` unless it has a value.
 */
export function fieldList(
	index: PresetIndex,
	preset: Preset,
	tags: Tags,
	geometry: PresetGeometry,
	added: ReadonlySet<string>,
): FieldList {
	const forGeometry = (f: Field) =>
		!f.geometry || f.geometry.includes(geometry);
	const allowed = (f: Field) =>
		forGeometry(f) && (hasValue(f, tags) || meets(f.prerequisiteTag, tags));
	const { fields, moreFields } = index.fieldsOf(preset);
	const own = new Set(fields);
	const others = [...new Set([...moreFields, ...index.universalFields()])]
		.filter((f) => !own.has(f))
		.sort((a, b) => a.label.localeCompare(b.label))
		.filter(allowed);
	const isShown = (f: Field) => hasValue(f, tags) || added.has(f.id);
	return {
		shown: [...fields.filter(allowed), ...others.filter(isShown)],
		addable: others
			.filter((f) => !isShown(f))
			.sort((a, b) => Number(a.universal) - Number(b.universal)),
	};
}

/** A localized field's other languages: `name:fr`, `name:zh-Hant` (iD's language suffix). */
const LANGUAGE_SUFFIX =
	/^(.*):([a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-[0-9]{3})?(?:-[a-z][a-z0-9]{4,7}|-[0-9][a-z0-9]{3})?)$/;

/** The keys a field edits, with those `tags` have for its languages or its multiCombo prefix. */
export function fieldKeys(field: Field, tags: Tags): string[] {
	const keys = new Set<string>();
	if (field.key) keys.add(field.key);
	for (const key of field.keys ?? []) keys.add(key);
	if (field.key && field.type === "localized") {
		const prefix = `${field.key}:`;
		for (const key of Object.keys(tags)) {
			if (key.startsWith(prefix) && LANGUAGE_SUFFIX.test(key)) keys.add(key);
		}
	}
	if (field.key && field.type === "multiCombo") {
		const prefix = field.key.endsWith(":") ? field.key : `${field.key}:`;
		for (const key of Object.keys(tags)) {
			if (key.startsWith(prefix)) keys.add(key);
		}
	}
	return [...keys];
}

/** Whether the feature has a value for the field. */
export function hasValue(field: Field, tags: Tags): boolean {
	return fieldKeys(field, tags).some((key) => tags[key] !== undefined);
}

function meets(prerequisite: PrerequisiteTag | undefined, tags: Tags): boolean {
	if (!prerequisite) return true;
	if (prerequisite.key) {
		const value = tags[prerequisite.key] ?? "";
		if (prerequisite.valuesNot) return !prerequisite.valuesNot.includes(value);
		if (prerequisite.valueNot) return prerequisite.valueNot !== value;
		if (prerequisite.values) return prerequisite.values.includes(value);
		if (prerequisite.value) return prerequisite.value === value;
		return value !== "";
	}
	if (prerequisite.keyNot) return !tags[prerequisite.keyNot];
	return true;
}

/** Whether "Add field" finds the field for `query`: by label, search terms or key. */
export function matchesField(field: Field, query: string): boolean {
	const q = query.trim().toLowerCase();
	return [field.label, ...field.terms, ...fieldKeys(field, {})].some((text) =>
		text.toLowerCase().includes(q),
	);
}

/** The tags once the field is added from "Add field": with its default, when it has one. */
export function addField(field: Field, tags: Tags): Tags {
	if (
		!field.key ||
		field.default === undefined ||
		tags[field.key] !== undefined
	)
		return tags;
	return { ...tags, [field.key]: field.default };
}

/** The tags without any of the field's keys. */
export function removeField(field: Field, tags: Tags): Tags {
	const keys = fieldKeys(field, tags);
	return Object.fromEntries(
		Object.entries(tags).filter(([key]) => !keys.includes(key)),
	);
}

/**
 * Whether a key of the field differs from the downloaded tags (`base`; undefined for a new
 * feature, where any value counts).
 */
export function isModified(
	field: Field,
	base: Tags | undefined,
	tags: Tags,
): boolean {
	if (!base) return fieldKeys(field, tags).some((key) => !!tags[key]);
	return [...fieldKeys(field, base), ...fieldKeys(field, tags)].some(
		(key) => tags[key] !== base[key],
	);
}

/** The tags with the field's keys as downloaded (none for a new feature). */
export function revertField(
	field: Field,
	base: Tags | undefined,
	tags: Tags,
): Tags {
	const result: Record<string, string> = { ...removeField(field, tags) };
	for (const key of base ? fieldKeys(field, base) : []) {
		const value = base?.[key];
		if (value !== undefined) result[key] = value;
	}
	return result;
}

/** Fields iD protects on a feature linked to Wikidata (`ui/fields/input.js`). */
const LOCKED_WITH_WIKIDATA = ["brand", "network", "operator", "flag"];

/**
 * Whether the field can't be edited, as in iD: the name, brand, network, operator or flag of a
 * feature linked to Wikidata, which is likely important and researched.
 */
export function isLocked(field: Field, tags: Tags): boolean {
	if (field.id === "name") {
		return (
			tags.wikidata !== undefined ||
			tags["name:etymology:wikidata"] !== undefined
		);
	}
	return LOCKED_WITH_WIKIDATA.includes(field.id) && tags.wikidata !== undefined;
}
