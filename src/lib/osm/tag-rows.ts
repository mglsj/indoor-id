/**
 * Rows of the tag table, as iD's raw tag editor keeps them: sorted when shown, then where they
 * are while the user edits (new keys last, a renamed key in its place), with a blank row last
 * to add a tag. Rows keep an id so an input keeps its place (and focus) when its key changes.
 */
import type { Tags } from "./tags.ts";

export interface TagRow {
	readonly id: number;
	/** "" for the blank row. */
	readonly key: string;
}

let nextId = 1;

/** The rows for `tags`, following the rows shown so far. */
export function reconcileRows(rows: readonly TagRow[], tags: Tags): TagRow[] {
	const kept = rows.filter((row) => row.key && tags[row.key] !== undefined);
	const shown = new Set(kept.map((row) => row.key));
	const added = Object.keys(tags)
		.filter((key) => !shown.has(key))
		.sort()
		.map((key) => ({ id: nextId++, key }));
	const blank = rows.find((row) => !row.key) ?? { id: nextId++, key: "" };
	return [...kept, ...added, blank];
}

/** The tags with `from` renamed `to`, keeping its value and its place among the keys. */
export function renameTag(tags: Tags, from: string, to: string): Tags {
	return Object.fromEntries(
		Object.entries(tags).map(([key, value]) => [
			key === from ? to : key,
			value,
		]),
	);
}
