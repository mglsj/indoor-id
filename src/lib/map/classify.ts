/**
 * How the map draws each feature, decided once per feature in code rather than in long style
 * expressions. The rules follow the OsmInEdit stylesheet (`public/style.mapcss`) and Simple Indoor
 * Tagging, plus older tags still found in the data (`room=*`, `buildingpart=*`).
 */
import { isVertical, type Tags } from "#lib/osm/tags.ts";
import type { Preset } from "#lib/presets/presets.ts";

export type FeatureKind =
	/** Walled indoor space: `indoor=room`. */
	| "room"
	/** Open indoor space: `indoor=area|corridor|level`, platforms. */
	| "space"
	/** Stairwell, elevator shaft, escalator area. */
	| "vertical"
	| "wall"
	/** Indoor fence: a railing along a gallery, ticket barriers (P6). */
	| "railing"
	| "column"
	| "building"
	/** Door or entrance (point, or line for a wide opening); a turnstile or gate indoors. */
	| "door"
	/** Opening without a door: `door=no`. */
	| "passage"
	/** Walkable line: corridors, footways, steps. */
	| "path"
	| "poi"
	| "line"
	| "area";

export type GeometryType = "Point" | "LineString" | "Polygon" | "MultiPolygon";

const SPACE_ROOMS = new Set([
	"corridor",
	"hall",
	"entry",
	"gallery",
	"collection",
	"entrance",
]);
const SPACE_HIGHWAYS = new Set(["pedestrian", "footway", "corridor"]);

export function classify(tags: Tags, geometry: GeometryType): FeatureKind {
	const surface = geometry === "Polygon" || geometry === "MultiPolygon";

	if (!surface && (tags.door !== undefined || tags.entrance !== undefined)) {
		return tags.door === "no" ? "passage" : "door";
	}
	if (!surface && isOpeningBarrier(tags) && isIndoorTagged(tags)) return "door";
	if (!surface && isIndoorFence(tags)) return "railing";
	if (surface && isVertical(tags)) return "vertical";
	if (tags.indoor === "wall") return "wall";
	if (
		tags.indoor === "column" ||
		tags.man_made === "pillar" ||
		tags["building:part"] === "column"
	) {
		return "column";
	}
	if (surface) {
		// SIT's `indoor=*` says what kind of space it is; the older `room=*` and `buildingpart=*`
		// only decide when it is missing or just `yes` (`indoor=area` + `room=toilets` is an open
		// space).
		if (tags.indoor === "room") return "room";
		if (isSpace(tags)) return "space";
		if (
			(tags.indoor === undefined || tags.indoor === "yes") &&
			(tags.buildingpart === "room" ||
				(tags.room !== undefined && !SPACE_ROOMS.has(tags.room)))
		) {
			return "room";
		}
		// A building part that is also an indoor space is drawn as indoor, on its level (W2;
		// `building-part-indoor` still warns about it).
		const indoor = tags.indoor !== undefined && tags.indoor !== "no";
		if (
			(tags.building !== undefined && tags.building !== "no") ||
			(tags["building:part"] !== undefined && !indoor)
		) {
			return "building";
		}
		return "area";
	}
	if (geometry === "Point") return "poi";
	return tags.highway !== undefined ? "path" : "line";
}

/** Gates and turnstiles: openings in a fence, drawn indoors as doors are (P6). */
const OPENING_BARRIERS = new Set([
	"gate",
	"turnstile",
	"full-height_turnstile",
	"swing_gate",
	"lift_gate",
	"sliding_gate",
	"wicket_gate",
	"entrance",
]);

/** Whether a point is a gate or turnstile (indoors or not). */
export function isOpeningBarrier(tags: Tags): boolean {
	return tags.barrier !== undefined && OPENING_BARRIERS.has(tags.barrier);
}

/** Whether tags put a feature indoors: `level`, `repeat_on` or `indoor=*`. */
function isIndoorTagged(tags: Tags): boolean {
	return (
		tags.level !== undefined ||
		tags.repeat_on !== undefined ||
		(tags.indoor !== undefined && tags.indoor !== "no")
	);
}

/**
 * An indoor fence (osm-simple3d-editor `094fc0a`, forum #198): `barrier=fence` with `level` or
 * `indoor=yes`, a railing along a gallery or a line of ticket barriers.
 */
export function isIndoorFence(tags: Tags): boolean {
	return tags.barrier === "fence" && isIndoorTagged(tags);
}

/**
 * Whether an area is a building's outline, whatever else it is drawn as: a mall
 * (`building=retail` + `shop=mall`) is drawn as an open space, yet outlines a building.
 */
export function isBuildingOutline(tags: Tags, geometry: GeometryType): boolean {
	const surface = geometry === "Polygon" || geometry === "MultiPolygon";
	return surface && tags.building !== undefined && tags.building !== "no";
}

function isSpace(tags: Tags): boolean {
	return (
		tags.indoor === "area" ||
		tags.indoor === "corridor" ||
		tags.indoor === "level" ||
		tags.buildingpart === "corridor" ||
		tags.buildingpart === "hall" ||
		(tags.room !== undefined && SPACE_ROOMS.has(tags.room)) ||
		(tags.highway !== undefined && SPACE_HIGHWAYS.has(tags.highway)) ||
		tags.public_transport === "platform" ||
		tags.railway === "platform" ||
		tags.shop === "mall"
	);
}

/** Whether a space is closed to the public, drawn darker. */
export function isRestricted(tags: Tags): boolean {
	return (
		tags.access === "private" ||
		tags.access === "no" ||
		tags.room === "technical"
	);
}

/** Room types whose icon has another name. */
const ROOM_ICON_ALIASES: Readonly<Record<string, string>> = {
	amphitheatre: "auditorium",
	reception: "administration",
	refectory: "restaurant",
	checkroom: "locker",
};

/** Keys whose value names an icon, `key_value`, in order of priority. */
const ICON_KEYS = [
	"amenity",
	"shop",
	"tourism",
	"emergency",
	"healthcare",
	"office",
	"leisure",
	"craft",
	"railway",
	"barrier",
	"man_made",
	"historic",
	"natural",
	"aeroway",
	"sport",
];

/**
 * Presets of the building's structure, which the map already shows by its shapes and colours:
 * an icon on every room or door would only clutter it.
 */
const STRUCTURE_PRESETS =
	/^(indoor(\/(room|area|corridor|level|wall|door))?$|(door|entrance|building|building_part|highway\/(corridor|footway|pedestrian_area))(\/|$))/;

/**
 * The icon of a feature, or null: its preset's icon (Maki or Temaki) when bundled, else the
 * first available OsmInEdit icon.
 */
export function iconFor(
	tags: Tags,
	available: ReadonlySet<string>,
	preset?: Pick<Preset, "id" | "icon">,
): string | null {
	const candidates: string[] = [];
	if (preset?.icon && !STRUCTURE_PRESETS.test(preset.id)) {
		candidates.push(preset.icon);
	}
	if (tags.conveying !== undefined || tags.room === "escalator") {
		candidates.push("passage_escalator");
	}
	if (
		tags.elevator === "yes" ||
		tags.highway === "elevator" ||
		tags.room === "elevator"
	) {
		candidates.push("highway_elevator");
	}
	if (
		tags.stairs === "yes" ||
		tags.highway === "steps" ||
		tags.room === "stairs"
	) {
		candidates.push("highway_steps");
	}
	for (const key of ICON_KEYS) {
		if (tags[key] !== undefined) candidates.push(`${key}_${tags[key]}`);
	}
	if (tags.room !== undefined) {
		candidates.push(`room_${ROOM_ICON_ALIASES[tags.room] ?? tags.room}`);
	}
	return candidates.find((icon) => available.has(icon)) ?? null;
}

const TRACKS = new Set([
	"rail",
	"subway",
	"light_rail",
	"tram",
	"narrow_gauge",
	"monorail",
	"funicular",
]);

/** The standard gauge, when a track doesn't say. */
const STANDARD_GAUGE_MM = 1435;

/**
 * A railway track's gauge in metres, or null for anything else: the first of `gauge` (in
 * millimetres, `1000;1435` for dual gauge), else standard gauge (V.3, stations).
 */
export function trackGauge(tags: Tags): number | null {
	if (tags.railway === undefined || !TRACKS.has(tags.railway)) return null;
	const first = Number.parseFloat(tags.gauge?.split(";")[0] ?? "");
	const mm =
		Number.isFinite(first) && first > 100 && first < 3000
			? first
			: STANDARD_GAUGE_MM;
	return mm / 1000;
}

/** Text shown on the map: the name, or else the ref (e.g. a room number). */
export function labelFor(tags: Tags): string | null {
	return tags.name ?? tags.ref ?? null;
}

/**
 * An entrance's label in the viewer (P6, osm-simple3d-editor `a58c319`): its name, else its
 * `ref` (the staircase number) over the flats it leads to (`addr:flats`, `1-36;40` shown as
 * `1–36, 40`). Null for anything else, or an entrance saying neither.
 */
export function entranceLabel(tags: Tags): string | null {
	if (tags.entrance === undefined || tags.entrance === "no") return null;
	if (tags.name) return tags.name;
	const flats = tags["addr:flats"]
		?.split(";")
		.map((part) => part.trim().replace(/\s*-\s*/g, "–"))
		.filter((part) => part !== "")
		.join(", ");
	const lines = [tags.ref, flats].filter((line) => line);
	return lines.length > 0 ? lines.join("\n") : null;
}

/** Which way arrows point along a line, if any: steps and ramps up, escalators and walkways. */
export type ArrowDirection = "forward" | "backward" | "both";

/**
 * Arrows along a line (P5.3.8): `incline=up` (or a positive slope, `10%`) points the way the
 * line runs, `down` (negative) against it; `conveying=forward|backward` the way it moves,
 * `reversible` both ways. `conveying` wins: an escalator's direction is how it moves.
 */
export function arrowOf(tags: Tags): ArrowDirection | null {
	switch (tags.conveying) {
		case "forward":
		case "yes":
			return "forward";
		case "backward":
			return "backward";
		case "reversible":
			return "both";
	}
	const incline = tags.incline?.trim();
	if (!incline) return null;
	if (incline === "up") return "forward";
	if (incline === "down") return "backward";
	const slope = Number.parseFloat(incline);
	if (!Number.isFinite(slope) || slope === 0) return null;
	return slope > 0 ? "forward" : "backward";
}

/**
 * A door's width in metres from `width` (`0.9`, `0.9 m`, `90 cm`, `3'`), or null when it can't
 * be read or isn't between 0.3 and 20 m.
 */
export function doorWidth(tags: Tags): number | null {
	const value = tags.width?.trim().replace(",", ".");
	if (!value) return null;
	const imperial =
		/^(?:(\d+(?:\.\d+)?)\s*(?:'|ft))?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in))?$/.exec(
			value,
		);
	const match = /^(\d+(?:\.\d+)?)\s*(m|cm|mm)?$/.exec(value);
	let metres: number;
	if (match) {
		const number = Number(match[1]);
		const unit = match[2] ?? "m";
		metres =
			unit === "cm" ? number / 100 : unit === "mm" ? number / 1000 : number;
	} else if (imperial && (imperial[1] || imperial[2])) {
		metres =
			Number(imperial[1] ?? 0) * 0.3048 + Number(imperial[2] ?? 0) * 0.0254;
	} else {
		return null;
	}
	return metres >= 0.3 && metres <= 20 ? metres : null;
}
