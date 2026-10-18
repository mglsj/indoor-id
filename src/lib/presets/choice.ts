/**
 * Values of iD's check and radio fields (`ui/fields/check.ts`, `ui/fields/radio.js`): the
 * values a check cycles through, what it shows, and the tags a radio choice sets.
 */
import type { Tags } from "#lib/osm/tags.ts";
import type { TagPatch } from "./combo.ts";
import type { Field, FieldOption } from "./presets.ts";

/** What a check field cycles through, with their texts: unset first. */
function checkValues(
	field: Field,
): { value: string | undefined; text: string }[] {
	if (field.options.length > 0) {
		return field.options.map((o) => ({
			value: o.value === "undefined" ? undefined : o.value,
			text: o.label,
		}));
	}
	return [
		{ value: undefined, text: "Unknown" },
		{ value: "yes", text: "Yes" },
		...(field.type === "defaultCheck" ? [] : [{ value: "no", text: "No" }]),
	];
}

/** The value after `current` when the check is clicked; an unknown value goes back to unset. */
export function nextCheckValue(
	field: Field,
	current: string | undefined,
): string | undefined {
	const values = checkValues(field).map((v) => v.value);
	const value = current?.toLowerCase() || undefined;
	const next = values[(values.indexOf(value) + 1) % values.length];
	// Clicks don't cycle through these (iD #4970).
	if (next === "reversible" || next === "alternating") return values[0];
	return next;
}

export interface CheckState {
	readonly checked: boolean;
	/** Unset, for a check that isn't yes by default. */
	readonly indeterminate: boolean;
	/** The value's text, or the value in quotes when the field doesn't know it. */
	readonly text: string;
	readonly raw: boolean;
}

export function checkState(
	field: Field,
	current: string | undefined,
): CheckState {
	const value = current?.toLowerCase() || undefined;
	const known = checkValues(field).find((v) => v.value === value);
	return {
		checked: value !== undefined && value !== "no",
		indeterminate: field.type !== "defaultCheck" && value === undefined,
		text: known ? known.text : `"${current}"`,
		raw: !known,
	};
}

/** A radio's choices: the field's options (or keys), and a value set that isn't one of them. */
export function radioOptions(field: Field, tags: Tags): FieldOption[] {
	const options =
		field.options.length > 0
			? [...field.options]
			: (field.keys ?? []).map((key) => ({ value: key, label: key }));
	const current = field.key ? tags[field.key] : undefined;
	if (current !== undefined && !options.some((o) => o.value === current)) {
		options.push({ value: current, label: current });
	}
	return options;
}

/** The radio's choice among `tags`: its key's value, or the one of its keys set to other than no. */
export function radioChoice(field: Field, tags: Tags): string | undefined {
	if (field.key) return tags[field.key];
	const set = (field.keys ?? []).filter(
		(key) => tags[key] !== undefined && tags[key]?.toLowerCase() !== "no",
	);
	return set.length === 1 ? set[0] : undefined;
}

/**
 * Tags for choosing `choice`. A radio without a key (structure) sets the key chosen, to the value
 * it had before (`remembered`) or `yes`, and unsets its others; a structure also sets `layer`.
 */
export function radioPatch(
	field: Field,
	tags: Tags,
	choice: string,
	remembered: Readonly<Record<string, string>> = {},
): TagPatch {
	if (field.key) return { [field.key]: choice };
	const patch: TagPatch = {};
	for (const key of field.keys ?? []) {
		patch[key] =
			key === choice ? (tags[key] ?? remembered[key] ?? "yes") : undefined;
	}
	if (field.type === "structureRadio") {
		patch.layer = structureLayer(tags.layer, choice, patch[choice]);
	}
	return patch;
}

/**
 * Tags for a structure's type (`bridge=viaduct`), with its layer: as iD, but a layer already on
 * the right side of the ground stays (iD sets 1 or -1 again).
 */
export function structureTypePatch(
	tags: Tags,
	structure: string,
	value: string | undefined,
): TagPatch {
	return {
		[structure]: value,
		layer: structureLayer(tags.layer, structure, value),
	};
}

/** A bridge is above the ground (layer 1 unless already higher), a tunnel below; others have none. */
function structureLayer(
	layer: string | undefined,
	structure: string,
	value: string | undefined,
): string | undefined {
	const n = Number(layer);
	const has = layer !== undefined && layer !== "" && !Number.isNaN(n);
	if (value === undefined || value === "no") return undefined;
	if (structure === "bridge") return has && n > 0 ? layer : "1";
	if (structure === "tunnel" && value !== "building_passage") {
		return has && n < 0 ? layer : "-1";
	}
	return undefined;
}
