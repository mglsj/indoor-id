/**
 * What the level switcher lists (L): the levels of the indoor data in view, with the names
 * mappers gave them, without the levels a building skips.
 *
 * Names come from `level:ref` and `name` on `indoor=level` outlines, else from a building's
 * `building:levels:ref` (floor names from the lowest floor, `Rez;1;2`) and
 * `building:levels:ref:equivalent` (`1=level 0;2=level 1`). `non_existent_levels` (`4;13`)
 * on a building removes those levels, unless a feature names one of them itself.
 * See https://wiki.openstreetmap.org/wiki/Key:level:ref and
 * https://wiki.openstreetmap.org/wiki/Key:building:levels:ref
 */
import type { Tags } from "#lib/osm/tags.ts";
import { featureLevels, isFromBuildingLevels } from "./feature-levels.ts";
import { isOnLevel, type Levels, parseLevels } from "./levels.ts";

/** What a level is called, as mapped: both are free text. */
export interface LevelName {
	/** `level:ref`: a number, a code (`E0`, `U1`), US numbering or a name. */
	readonly ref?: string;
	readonly name?: string;
}

/** A level in the switcher. */
export interface LevelEntry extends LevelName {
	readonly level: number;
}

/** The `level:ref` and `name` of an `indoor=level` outline on one level, if it has either. */
export function outlineLevelName(tags: Tags): LevelEntry | null {
	if (tags.indoor !== "level" || tags.level === undefined) return null;
	const levels = parseLevels(tags.level);
	const only = levels?.length === 1 ? levels[0] : undefined;
	if (!only || only.min !== only.max) return null;
	const ref = text(tags["level:ref"]);
	const name = text(tags.name);
	if (ref === undefined && name === undefined) return null;
	return { level: only.min, ...(ref && { ref }), ...(name && { name }) };
}

const EQUIVALENT = /^(.+?)\s*=\s*level\s+(-?\d+(?:\.\d+)?)$/i;

/**
 * A building's floor names by level. `building:levels:ref:equivalent` says which floor is
 * which level; `building:levels:ref` lists names from the lowest floor, read by position only
 * when it names every floor the building counts (the list may be incomplete, and then which
 * floor a name belongs to is unknown).
 */
export function buildingLevelRefs(tags: Tags): Map<number, string> {
	const refs = new Map<number, string>();
	const list = tags["building:levels:ref"]?.split(";").map((r) => r.trim());
	const levels = list && featureLevels(tags);
	const range = levels?.length === 1 ? levels[0] : undefined;
	if (
		list &&
		range &&
		Number.isInteger(range.min) &&
		Number.isInteger(range.max) &&
		range.max - range.min + 1 === list.length &&
		(isFromBuildingLevels(tags) ||
			(tags.min_level !== undefined && tags.max_level !== undefined))
	) {
		list.forEach((ref, i) => {
			if (ref) refs.set(range.min + i, ref);
		});
	}
	for (const item of tags["building:levels:ref:equivalent"]?.split(";") ?? []) {
		const match = EQUIVALENT.exec(item.trim());
		if (match?.[1] && match[2]) refs.set(Number(match[2]), match[1]);
	}
	return refs;
}

/** The levels a building says don't exist (`non_existent_levels=4;13`), if readable. */
export function nonExistentLevels(tags: Tags): Levels | null {
	const value = tags.non_existent_levels;
	return value === undefined ? null : parseLevels(value);
}

/**
 * The levels a feature names itself in `level` and `repeat_on`: single levels and the ends
 * of ranges. An elevator on `1-15` names 1 and 15, not the 13 a building skips.
 */
export function explicitLevels(tags: Tags): number[] {
	const found: number[] = [];
	for (const value of [tags.level, tags.repeat_on]) {
		if (value === undefined || !parseLevels(value)) continue;
		for (const item of value.split(";")) {
			const range = parseLevels(item);
			for (const { min, max } of range ?? []) found.push(min, max);
		}
	}
	return [...new Set(found)];
}

/** What the indoor data in view says about its levels. */
export interface LevelSources {
	/** The levels features in view are on, as `knownLevels` lists them. */
	readonly levels: readonly number[];
	/** Levels some feature in view names itself (see `explicitLevels`). */
	readonly explicit: ReadonlySet<number>;
	/** Names by level, the first for a level winning. */
	readonly names: ReadonlyMap<number, LevelName>;
	/** The `non_existent_levels` of the buildings in view. */
	readonly nonExistent: readonly Levels[];
}

/** No more buttons than this come from filling gaps (a stray `level=99` adds none). */
const MAX_FILLED = 100;

/**
 * The switcher's levels, sorted ascending: the levels in view, the whole levels missing
 * between them (0, 1, 3 gets a 2), less the levels a building skips that no feature names.
 */
export function levelList({
	levels,
	explicit,
	names,
	nonExistent,
}: LevelSources): LevelEntry[] {
	const all = new Set(levels);
	const low = levels[0];
	const high = levels.at(-1);
	if (
		low !== undefined &&
		high !== undefined &&
		Math.floor(high) - Math.ceil(low) < MAX_FILLED
	) {
		for (let l = Math.ceil(low); l <= high; l++) all.add(l);
	}
	return [...all]
		.filter((l) => explicit.has(l) || !nonExistent.some((n) => isOnLevel(n, l)))
		.sort((a, b) => a - b)
		.map((level) => ({ level, ...names.get(level) }));
}

/** At most this many characters on a switcher button; the tooltip has the rest. */
export const SHORT_LABEL = 6;

/** A level's label on its button: its `level:ref`, else its name, else its number. */
export function shortLabel(entry: LevelEntry, max = SHORT_LABEL): string {
	const label = entry.ref ?? entry.name ?? String(entry.level);
	const chars = [...label];
	return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : label;
}

/** A level's full description: `EG · Erdgeschoss · level 0`, or `Level 0` without names. */
export function fullLabel(entry: LevelEntry): string {
	const names = [...new Set([entry.ref, entry.name])].filter(
		(n) => n !== undefined,
	);
	return names.length > 0
		? `${names.join(" · ")} · level ${String(entry.level)}`
		: `Level ${String(entry.level)}`;
}

function text(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}
