/**
 * How the viewer labels levels nobody named (V.1, after osm-simple3d-editor `40063a9`): OSM's
 * `level` counts from 0 at the ground floor, as floors do in the UK and most of Europe ("Ground
 * floor, 1, 2…"); in North America, Russia and East Asia the ground floor is the first
 * ("1, 2, 3…"). Only labels change, never tags; a level with a `level:ref` or a name keeps it.
 */
import type { LevelEntry } from "./level-names.ts";

/** `from-0`: Ground floor, 1, 2…; `from-1`: 1, 2, 3… */
export type FloorNumbering = "from-0" | "from-1";

/** Regions whose ground floor is floor 1. */
const FROM_ONE = new Set([
	"US",
	"CA",
	"RU",
	"BY",
	"KZ",
	"CN",
	"JP",
	"KR",
	"TW",
]);

/** The numbering usual where the browser's language points (`en-US`, `ru`, `de-AT`). */
export function defaultNumbering(locale: string): FloorNumbering {
	let region: string | undefined;
	try {
		// `ru` alone stands for Russia, `en` for the US (likely subtags).
		region = new Intl.Locale(locale).maximize().region;
	} catch {
		return "from-0";
	}
	return region && FROM_ONE.has(region) ? "from-1" : "from-0";
}

/**
 * A level's entry for the switcher, labelled as `numbering` counts floors when it has no
 * `level:ref` or name: level 0 is "G" (Ground floor) or "1" (Floor 1). Basements keep their
 * numbers in both.
 */
export function numberedEntry(
	entry: LevelEntry,
	numbering: FloorNumbering,
): LevelEntry {
	if (entry.ref !== undefined || entry.name !== undefined) return entry;
	const { level } = entry;
	if (numbering === "from-0" && level === 0) {
		return { level, ref: "G", name: "Ground floor" };
	}
	const floor = numbering === "from-1" && level >= 0 ? level + 1 : level;
	return { level, ref: String(floor), name: `Floor ${String(floor)}` };
}
