/**
 * Indoor levels, as written in `level=*` and `repeat_on=*` tags.
 *
 * A value is a `;`-separated list of levels (`0`, `-1`, `0.5`) or ranges (`0-2`, `-2--1`).
 * A range covers every level in between, including mezzanines such as 0.5, while a list does
 * not: `0;1` is two levels, `0-1` is everything from 0 to 1.
 * See https://wiki.openstreetmap.org/wiki/Key:level
 */

/** A closed range of levels. A single level has `min === max`. */
export interface LevelRange {
	readonly min: number;
	readonly max: number;
}

/** Sorted, non-overlapping level ranges. */
export type Levels = readonly LevelRange[];

const ITEM = /^(-?\d+(?:\.\d+)?)(?:-(-?\d+(?:\.\d+)?))?$/;

/**
 * Parses a `level=*` style value. Returns null when the value can't be read safely, so callers
 * never replace data they don't understand. Commas are rejected: `1,5` could be a list or a
 * decimal comma.
 */
export function parseLevels(value: string): Levels | null {
	const ranges: LevelRange[] = [];
	for (const item of value.split(";")) {
		const match = ITEM.exec(item.trim());
		if (!match) return null;
		const a = Number(match[1]);
		const b = match[2] === undefined ? a : Number(match[2]);
		ranges.push({ min: Math.min(a, b), max: Math.max(a, b) });
	}
	return normalizeLevels(ranges);
}

/** Sorts ranges and merges the ones that overlap. Touching single levels stay separate. */
export function normalizeLevels(ranges: Iterable<LevelRange>): Levels {
	const sorted = [...ranges].sort((a, b) => a.min - b.min || a.max - b.max);
	const merged: LevelRange[] = [];
	for (const range of sorted) {
		const last = merged.at(-1);
		if (last && range.min <= last.max) {
			merged[merged.length - 1] = {
				min: last.min,
				max: Math.max(last.max, range.max),
			};
		} else {
			merged.push(range);
		}
	}
	return merged;
}

/** Writes levels as a tag value, e.g. `-1;0.5;2-4`. */
export function formatLevels(levels: Levels): string {
	return levels
		.map(({ min, max }) =>
			min === max ? String(min) : `${String(min)}-${String(max)}`,
		)
		.join(";");
}

/** Whether a feature on `levels` is visible when `level` is selected. */
export function isOnLevel(levels: Levels, level: number): boolean {
	return levels.some(({ min, max }) => level >= min && level <= max);
}

/**
 * The level to show for something on `value` (a `level` tag), the map showing `shown`: its
 * level, or with several, `shown` if it is one of them, else the lowest. Without a level, or
 * with one that can't be read, the map stays where it is.
 */
export function levelToShow(value: string | null, shown: number): number {
	const levels = value === null ? null : parseLevels(value);
	if (!levels || levels.length === 0 || isOnLevel(levels, shown)) return shown;
	return Math.min(...levels.map((l) => l.min));
}

/**
 * The widest range whose whole levels are listed: no building has more floors, and a stray
 * `level=0-10000000` in the data mustn't list ten million.
 */
export const MAX_LEVEL_SPAN = 250;

/**
 * A range's ends and the whole levels between them (`-0.5-2` → -0.5, 0, 1, 2); only its ends
 * when it spans more than `MAX_LEVEL_SPAN` levels.
 */
export function wholeLevels({ min, max }: LevelRange): number[] {
	const levels = new Set([min, max]);
	if (max - min <= MAX_LEVEL_SPAN) {
		for (let l = Math.ceil(min); l <= Math.floor(max); l++) levels.add(l);
	}
	return [...levels].sort((a, b) => a - b);
}

/**
 * Every level of a value, sorted, with ranges of whole levels listed; null if it can't be (a
 * range of non-whole levels, or one wider than `MAX_LEVEL_SPAN`).
 */
export function listLevels(value: string): number[] | null {
	const ranges = parseLevels(value);
	if (!ranges) return null;
	const levels: number[] = [];
	for (const { min, max } of ranges) {
		if (min === max) levels.push(min);
		else if (
			Number.isInteger(min) &&
			Number.isInteger(max) &&
			max - min <= MAX_LEVEL_SPAN
		) {
			for (let l = min; l <= max; l++) levels.push(l);
		} else return null;
	}
	return levels;
}
