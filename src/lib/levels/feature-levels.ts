import type { Tags } from "#lib/osm/tags.ts";
import {
	type LevelRange,
	type Levels,
	normalizeLevels,
	parseLevels,
} from "./levels.ts";

/**
 * Levels a feature is on, from the first of these sources that is present:
 * 1. `level=*` and `repeat_on=*` (combined)
 * 2. `min_level=*` + `max_level=*`
 * 3. `building:levels=*`, with `building:levels:underground=*` and `roof:levels=*`
 * 4. the `level=*` of parent `type=level` relations and multipolygons
 *
 * Returns null when no source can be read: unreadable values are never turned into level 0.
 * Callers decide how to show features without levels (e.g. outdoor features on every level).
 */
export function featureLevels(
	tags: Tags,
	parentRelationTags: readonly Tags[] | (() => readonly Tags[]) = [],
): Levels | null {
	if (tags.level !== undefined || tags.repeat_on !== undefined) {
		return union([tags.level, tags.repeat_on]);
	}
	if (tags.min_level !== undefined && tags.max_level !== undefined) {
		return parseLevels(`${tags.min_level}-${tags.max_level}`);
	}
	if (tags["building:levels"] !== undefined) {
		return buildingLevels(tags);
	}
	// Parent relations are only looked up when needed: a function is called last.
	const parents =
		typeof parentRelationTags === "function"
			? parentRelationTags()
			: parentRelationTags;
	const relationLevels = parents
		.filter((rel) => rel.type === "level" || rel.type === "multipolygon")
		.map((rel) => rel.level);
	return union(relationLevels);
}

/**
 * Whether a feature's levels come from `building:levels=*`: a count of floors, which draws the
 * building on them but says nothing about which levels have indoor data.
 */
export function isFromBuildingLevels(tags: Tags): boolean {
	return (
		tags.level === undefined &&
		tags.repeat_on === undefined &&
		(tags.min_level === undefined || tags.max_level === undefined) &&
		tags["building:levels"] !== undefined
	);
}

/** Union of levels, or null if there are none. */
export function unionOfLevels(all: readonly (Levels | null)[]): Levels | null {
	const ranges = all.flatMap((levels) => levels ?? []);
	return ranges.length > 0 ? normalizeLevels(ranges) : null;
}

/** Union of the readable values, or null if none is readable. */
function union(values: readonly (string | undefined)[]): Levels | null {
	const ranges: LevelRange[] = [];
	let readable = false;
	for (const value of values) {
		const levels = value === undefined ? null : parseLevels(value);
		if (levels) {
			readable = true;
			ranges.push(...levels);
		}
	}
	return readable ? normalizeLevels(ranges) : null;
}

/** Levels counted by `building:levels=*`: above ground from 0, underground from -1 down. */
function buildingLevels(tags: Tags): Levels | null {
	const aboveGround = count(tags["building:levels"]);
	if (aboveGround === null) return null;
	const total = aboveGround + (count(tags["roof:levels"]) ?? 0);
	const underground = count(tags["building:levels:underground"]) ?? 0;

	if (total === 0 && underground === 0) return null;
	return [{ min: -underground, max: total > 0 ? total - 1 : -1 }];
}

/** A non-negative level count, rounded up (2.5 levels means a third, partial level). */
function count(value: string | undefined): number | null {
	if (value === undefined || value.trim() === "") return null;
	const n = Number(value);
	return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : null;
}
