/**
 * How IndoorID tags indoor features in building mode, following osm-simple3d-editor's
 * conventions (ISC, see LICENSE.md) so that both editors draw what the other writes:
 *
 * - a room or area with a purpose is `indoor=room|area|corridor` + `room=<purpose>`; a purpose
 *   preset (Restroom: `amenity=toilets`) chosen on an area without `indoor` makes it
 *   `indoor=room`, and `room` is filled from the purpose (osm-simple3d-editor's `roomValueOf`,
 *   `src/osm/indoor-categories.ts`), as its "Purpose" field suggests;
 * - a flight of stairs drawn as a line is `highway=steps` + `indoor=yes` + `incline=up` +
 *   `level=<lower>;<upper>`, drawn from the bottom up (its `createEscalator(…, stairs)`).
 *
 * Pure: the editor applies these when a preset is chosen inside a building.
 */
import type { Tags } from "#lib/osm/tags.ts";

const FOOD = new Set([
	"cafe",
	"restaurant",
	"fast_food",
	"food_court",
	"bar",
	"pub",
	"ice_cream",
	"biergarten",
]);
const SERVICES = new Set([
	"bank",
	"atm",
	"post_office",
	"bureau_de_change",
	"money_transfer",
	"payment_centre",
	"dry_cleaning",
	"car_rental",
	"ticket_office",
]);
const MEDICAL = new Set([
	"pharmacy",
	"clinic",
	"doctors",
	"dentist",
	"hospital",
	"veterinary",
]);
const OFFICE = new Set([
	"toilets",
	"school",
	"college",
	"university",
	"library",
	"kindergarten",
	"training",
	"coworking_space",
]);

/**
 * The `room=*` value matching a feature's purpose tags (osm-simple3d-editor's
 * `roomValueOf`), or undefined when nothing matches.
 */
export function roomValueOf(tags: Tags): string | undefined {
	const a = tags.amenity;
	if (a && FOOD.has(a)) {
		if (a === "fast_food" || a === "restaurant") return "restaurant";
		return a === "bar" || a === "pub" ? "bar" : "cafe";
	}
	if ((a && MEDICAL.has(a)) || tags.healthcare) {
		return a === "pharmacy" ? "pharmacy" : "medical";
	}
	if (tags.shop || tags.craft || (a && SERVICES.has(a))) return "shop";
	if (tags.office) return "office";
	if (a === "toilets") return "toilets";
	if (a === "library") return "library";
	if (a && OFFICE.has(a)) return "class";
	if (a === "parking" || tags.parking) return "parking";
	return undefined;
}

/** Keys that give a room its purpose: a preset with one of them is a use of the room. */
const PURPOSE_KEYS = ["amenity", "shop", "office", "healthcare", "craft"];

/**
 * An area's tags after a purpose preset was chosen for it inside a building: `indoor=room`
 * when it has no `indoor` (nor is a building or building part), and `room` from the purpose
 * when it has none. Other tags, and an `indoor` or `room` already there, are kept.
 */
export function withRoomPurpose(tags: Tags): Tags {
	if (!PURPOSE_KEYS.some((key) => tags[key] !== undefined)) return tags;
	if (tags.building !== undefined || tags["building:part"] !== undefined) {
		return tags;
	}
	const indoor = tags.indoor ?? "room";
	if (indoor !== "room" && indoor !== "area" && indoor !== "corridor") {
		return tags;
	}
	const room = tags.room ?? roomValueOf(tags);
	if (tags.indoor === indoor && tags.room === room) return tags;
	return { ...tags, indoor, ...(room ? { room } : {}) };
}

/**
 * A line's tags after the Steps preset was chosen inside a building: `indoor=yes`, and, when it
 * is on one level, the flight going up to the next level (`levels`, the building's levels,
 * sorted) or, from the top level, down from the one below: `level=<lower>;<upper>` with
 * `incline=up` (drawn from the bottom up) or `incline=down`. A line already over two levels,
 * or with its `incline`, keeps them.
 */
export function asFlight(tags: Tags, levels: readonly number[]): Tags {
	if (tags.highway !== "steps" || tags.conveying !== undefined) return tags;
	const result: Record<string, string> = { ...tags };
	if (result.indoor === undefined) result.indoor = "yes";
	const here = Number(tags.level);
	if (
		tags.level !== undefined &&
		tags.level.trim() !== "" &&
		!Number.isNaN(here)
	) {
		const up = levels.find((l) => l > here);
		const down = [...levels].reverse().find((l) => l < here);
		if (up !== undefined || down === undefined) {
			result.level = `${tags.level};${up ?? here + 1}`;
			result.incline ??= "up";
		} else {
			result.level = `${down};${tags.level}`;
			result.incline ??= "down";
		}
	}
	return result;
}
