/** Suggestions of the tag table's key and value inputs, filtered and sorted as iD's. */
import type { Tags } from "#lib/osm/tags.ts";
import type { SuggestedValue } from "./combo.ts";

/** Those starting with `typed` first (as iD's raw tag editor). */
function startingFirst<T extends SuggestedValue>(
	typed: string,
	list: T[],
): T[] {
	return [
		...list.filter((s) => s.value.startsWith(typed)),
		...list.filter((s) => !s.value.startsWith(typed)),
	];
}

const containing = (typed: string) => (s: SuggestedValue) =>
	s.value.toLowerCase().includes(typed.toLowerCase());

/**
 * Keys to offer: not already set, not discardable (`created_by`…), not numbered (`name_1`),
 * containing what was typed.
 */
export function keySuggestions(
	found: readonly SuggestedValue[],
	typed: string,
	tags: Tags,
	discarded: readonly string[],
): SuggestedValue[] {
	return startingFirst(
		typed,
		found.filter(
			(s) =>
				tags[s.value] === undefined &&
				!discarded.includes(s.value) &&
				!/_\d$/.test(s.value) &&
				containing(typed)(s),
		),
	);
}

/** Values to offer: containing what was typed. */
export function valueSuggestions(
	found: readonly SuggestedValue[],
	typed: string,
): SuggestedValue[] {
	return startingFirst(typed, found.filter(containing(typed)));
}
