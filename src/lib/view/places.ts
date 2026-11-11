/**
 * The viewer's side panel (V.3): the named places in the loaded data (rooms, spaces, points
 * with a `name` or `ref`), searched by name and ref, and listed by level. Pure: it reads the
 * map's features (`@label`, `@kind`, `@lv`), so it lists what the map draws.
 */
import type { IndoorFeature } from "#lib/map/features.ts";
import type { Extent } from "#lib/osm/geometry.ts";
import { extentOfGeometry, levelsOf } from "./geometry.ts";

export interface Place {
	readonly id: string;
	/** Its name, else its ref. */
	readonly label: string;
	/** Its ref, when the label is its name. */
	readonly ref?: string;
	readonly kind: string;
	/** Its levels, or null when it has none (on every level). */
	readonly levels: readonly number[] | null;
	/** Where to centre the map on it. */
	readonly loc: readonly [number, number];
}

/** Kinds a reader looks for; walls, doors, lines and building outlines aren't listed. */
const LISTED = new Set(["room", "space", "vertical", "poi", "area", "column"]);

/** A feature's place, if it is named and of a kind the panel lists. */
export function placeOf(feature: IndoorFeature): Place | null {
	const p = feature.properties;
	const label = p["@label"];
	if (typeof label !== "string" || !LISTED.has(String(p["@kind"]))) return null;
	// Level outlines are the switcher's.
	if (p.indoor === "level") return null;
	const extent = extentOfGeometry(feature.geometry);
	if (!extent) return null;
	return {
		id: p["@id"],
		label,
		...(p.name !== undefined && p.ref !== undefined ? { ref: p.ref } : {}),
		kind: String(p["@kind"]),
		levels: levelsOf(p["@lv"]),
		loc: [(extent.west + extent.east) / 2, (extent.south + extent.north) / 2],
	};
}

/** The places of these features, sorted by label (numbers in order: B2 before B10). */
export function placesOf(features: Iterable<IndoorFeature>): Place[] {
	const places: Place[] = [];
	for (const feature of features) {
		const place = placeOf(feature);
		if (place) places.push(place);
	}
	return places.sort(byLabel);
}

const collator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

function byLabel(a: Place, b: Place): number {
	return collator.compare(a.label, b.label);
}

/** Lower case without accents, for matching what is typed. */
function fold(text: string): string {
	return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * The places whose label or ref contain every word of `query`, ignoring case and accents;
 * those starting with it first.
 */
export function searchPlaces(
	places: readonly Place[],
	query: string,
	limit = 50,
): Place[] {
	const words = fold(query).split(/\s+/).filter(Boolean);
	if (words.length === 0) return [];
	const scored: { place: Place; starts: boolean }[] = [];
	for (const place of places) {
		const text = fold(`${place.label} ${place.ref ?? ""}`);
		if (!words.every((w) => text.includes(w))) continue;
		const first = words[0] ?? "";
		scored.push({
			place,
			starts:
				fold(place.label).startsWith(first) ||
				fold(place.ref ?? "").startsWith(first),
		});
	}
	return scored
		.sort((a, b) => Number(b.starts) - Number(a.starts))
		.slice(0, limit)
		.map((s) => s.place);
}

/** The places on a level (or on every level) inside an extent. */
export function placesOnLevel(
	places: readonly Place[],
	level: number,
	extent: Extent,
): Place[] {
	return places.filter(
		(p) =>
			(p.levels === null || p.levels.includes(level)) &&
			p.loc[0] >= extent.west &&
			p.loc[0] <= extent.east &&
			p.loc[1] >= extent.south &&
			p.loc[1] <= extent.north,
	);
}
