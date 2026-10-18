import type { TagDocs } from "#lib/api/osm-wikibase.ts";
import type { Wikidata } from "#lib/api/wikidata.ts";
import type { Tags } from "#lib/osm/tags.ts";
import type { SuggestedValue, TagPatch } from "#lib/presets/combo.ts";
import type { Field } from "#lib/presets/presets.ts";
import type { TagReference } from "#lib/presets/wiki.ts";

/** What field inputs need from the editor, beyond their own tags. */
export interface FieldContext {
	/**
	 * Values used elsewhere for the field (taginfo), for what was typed; for a multiCombo, the
	 * keys under its prefix. Absent when there is no taginfo.
	 */
	readonly suggest?: (
		field: Field,
		query: string,
	) => Promise<readonly SuggestedValue[]>;
	/** Values the schema deprecates for a key. */
	readonly deprecated: (key: string) => readonly string[];
	/** A field of the schema by id (a structure's type field). */
	readonly field?: (id: string) => Field | undefined;
	/** Values for a part of an address (`addr:street`) from the data around the feature. */
	readonly nearby?: (key: string, part: string) => readonly string[];
	/** The OSM wiki's documentation of a key or tag, for ⓘ; absent without the wiki. */
	readonly docs?: (reference: TagReference) => Promise<TagDocs | null>;
	/**
	 * Changes the feature's tags in the undo step just made, once `work` resolves (iD sets the
	 * Wikipedia article of a Wikidata item that way); dropped if anything was done since.
	 */
	readonly amend?: (work: Promise<(tags: Tags) => Tags | null>) => void;
	/** Wikidata, for the wikidata and wikipedia fields. */
	readonly wikidata?: Pick<Wikidata, "search" | "entity" | "itemsByTitle">;
	/** Wikipedia article titles for a language and a text. */
	readonly searchWikipedia?: (lang: string, query: string) => Promise<string[]>;
}

export type { TagPatch } from "#lib/presets/combo.ts";

/** Keys whose values differ between the features edited: each feature's value (`combineTags`). */
export type MixedValues = ReadonlyMap<string, readonly (string | undefined)[]>;

/** Nothing mixed: one feature edited. */
export const NOT_MIXED: MixedValues = new Map();

/** A field's change: the tags to set (undefined removes), or those made from each feature's own. */
export type FieldChange = TagPatch | ((tags: Tags) => TagPatch);

/** The id of a field's input, which its label points at. */
export function fieldInputId(field: Field): string {
	return `field-${field.id.replaceAll(/[^\w-]/g, "-")}`;
}
