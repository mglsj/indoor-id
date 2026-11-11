/**
 * Rooms coloured by use in the viewer (V.3). A room or `indoor=area` takes its use from its own
 * purpose tags; one without any takes the use of the first point of interest inside it (a shop
 * node in an untagged room), as osm-simple3d-editor does (`9cc38ac`, `21136c6`):
 * - doors and entrances never count, and for areas neither do small things (ATMs, vending
 *   machines, benches, kiosks);
 * - only points on the room's floor (its lowest level) count;
 * - corridors never take a colour, and platforms (`room=platform`, `railway=platform`) are
 *   circulation: a shop on a platform doesn't tint it.
 */
import type { IndoorFeature } from "#lib/map/features.ts";
import { pointInPolygon } from "#lib/osm/geometry.ts";
import type { Tags } from "#lib/osm/tags.ts";
import { extentOfGeometry, levelsOf } from "./geometry.ts";

export type Use =
	| "food"
	| "shop"
	| "toilets"
	| "health"
	| "education"
	| "office"
	| "worship"
	| "service"
	| "platform";

const FOOD = new Set([
	"restaurant",
	"cafe",
	"fast_food",
	"bar",
	"pub",
	"food_court",
	"ice_cream",
	"biergarten",
]);
const HEALTH = new Set([
	"pharmacy",
	"doctors",
	"dentist",
	"clinic",
	"hospital",
	"veterinary",
]);
const EDUCATION = new Set([
	"school",
	"university",
	"college",
	"library",
	"kindergarten",
	"childcare",
]);
const EDUCATION_ROOMS = new Set([
	"class",
	"classroom",
	"lecture",
	"library",
	"computer",
	"laboratory",
]);
const OFFICE_ROOMS = new Set(["office", "meeting", "conference"]);
const TOILET_ROOMS = new Set(["toilets", "toilet", "shower"]);
const WORSHIP_ROOMS = new Set(["chapel", "prayer", "worship"]);
/** Small things that don't make an area theirs. */
const SMALL_AMENITIES = new Set([
	"atm",
	"vending_machine",
	"bench",
	"waste_basket",
	"drinking_water",
	"charging_station",
]);
const PURPOSE_KEYS = [
	"amenity",
	"shop",
	"office",
	"healthcare",
	"craft",
	"leisure",
	"tourism",
] as const;

function isPlatform(tags: Tags): boolean {
	return (
		tags.room === "platform" ||
		tags.railway === "platform" ||
		tags.public_transport === "platform"
	);
}

/** Whether a feature says what it is for (so it doesn't take a point's use). */
export function hasPurpose(tags: Tags): boolean {
	return (
		isPlatform(tags) ||
		PURPOSE_KEYS.some((key) => tags[key] !== undefined) ||
		(tags.room !== undefined && tags.room !== "yes")
	);
}

/** The use a feature's own tags give, or null when they give none the map colours. */
export function useOf(tags: Tags): Use | null {
	const { amenity, room } = tags;
	if (isPlatform(tags)) return "platform";
	if ((amenity && FOOD.has(amenity)) || (room && FOOD.has(room))) return "food";
	if (
		amenity === "toilets" ||
		amenity === "shower" ||
		(room && TOILET_ROOMS.has(room))
	)
		return "toilets";
	if (
		tags.healthcare !== undefined ||
		(amenity && HEALTH.has(amenity)) ||
		room === "medical"
	)
		return "health";
	if (
		(amenity && EDUCATION.has(amenity)) ||
		(room && EDUCATION_ROOMS.has(room))
	)
		return "education";
	if (tags.office !== undefined || (room && OFFICE_ROOMS.has(room)))
		return "office";
	if (amenity === "place_of_worship" || (room && WORSHIP_ROOMS.has(room)))
		return "worship";
	if (tags.shop !== undefined) return "shop";
	if (
		amenity !== undefined ||
		tags.craft !== undefined ||
		tags.leisure !== undefined ||
		tags.tourism !== undefined
	)
		return "service";
	return null;
}

function isSmall(tags: Tags): boolean {
	return (
		(tags.amenity !== undefined && SMALL_AMENITIES.has(tags.amenity)) ||
		tags.shop === "kiosk"
	);
}

interface Poi {
	readonly loc: [number, number];
	readonly levels: readonly number[] | null;
	readonly use: Use;
	readonly small: boolean;
}

/** The polygons of an area geometry, or none. */
function polygonsOf(feature: IndoorFeature): [number, number][][][] {
	const g = feature.geometry;
	if (g.type === "Polygon") return [g.coordinates as [number, number][][]];
	if (g.type === "MultiPolygon") return g.coordinates as [number, number][][][];
	return [];
}

/** The use of each room and area that has one, by feature id. */
export function roomUses(features: Iterable<IndoorFeature>): Map<string, Use> {
	const spaces: IndoorFeature[] = [];
	const pois: Poi[] = [];
	for (const feature of features) {
		const p = feature.properties;
		const kind = p["@kind"];
		if (feature.geometry.type === "Point") {
			if (kind !== "poi") continue;
			const use = useOf(p);
			if (!use) continue;
			const [lon = 0, lat = 0] = feature.geometry.coordinates;
			pois.push({
				loc: [lon, lat],
				levels: levelsOf(p["@lv"]),
				use,
				small: isSmall(p),
			});
		} else if (kind === "room" || p.indoor === "area" || isPlatform(p)) {
			spaces.push(feature);
		}
	}

	const uses = new Map<string, Use>();
	for (const space of spaces) {
		const p = space.properties;
		if (hasPurpose(p)) {
			const use = useOf(p);
			if (use) uses.set(p["@id"], use);
			continue;
		}
		const levels = levelsOf(p["@lv"]);
		const floor = levels === null ? null : Math.min(...levels);
		const area = p.indoor === "area";
		const extent = extentOfGeometry(space.geometry);
		const polygons = polygonsOf(space);
		if (!extent || polygons.length === 0) continue;
		const inside = pois.find(
			(poi) =>
				!(area && poi.small) &&
				(floor === null
					? poi.levels === null
					: poi.levels?.includes(floor) === true) &&
				poi.loc[0] >= extent.west &&
				poi.loc[0] <= extent.east &&
				poi.loc[1] >= extent.south &&
				poi.loc[1] <= extent.north &&
				polygons.some((polygon) => pointInPolygon(poi.loc, polygon)),
		);
		if (inside) uses.set(p["@id"], inside.use);
	}
	return uses;
}
