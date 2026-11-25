/** OSM tags of an entity. Keys and values are non-empty strings. */
export type Tags = Readonly<Record<string, string>>;

/** Keys that don't make a node worth keeping on their own: a vertex with only these is geometry. */
const UNINTERESTING_KEYS = new Set([
	"created_by",
	"source",
	"level",
	"repeat_on",
]);

/** Whether an entity carries information beyond its geometry (a POI, a door, ...). */
export function hasInterestingTags(tags: Tags): boolean {
	return Object.keys(tags).some((key) => !UNINTERESTING_KEYS.has(key));
}

const VERTICAL_ROOMS = new Set(["stairs", "escalator", "elevator"]);

/**
 * Stairs, elevators, escalators and stairwells: features that span levels rather than repeat
 * on them. The map draws them as vertical passages; the validator wants their levels in
 * `level`, not `repeat_on`.
 */
export function isVertical(tags: Tags): boolean {
	return (
		tags.stairs === "yes" ||
		tags.elevator === "yes" ||
		tags.highway === "elevator" ||
		tags.highway === "steps" ||
		tags.conveying !== undefined ||
		(tags.room !== undefined && VERTICAL_ROOMS.has(tags.room)) ||
		tags.buildingpart === "verticalpassage"
	);
}
