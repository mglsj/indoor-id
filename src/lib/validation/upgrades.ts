/**
 * Tag upgrades, in the format of iD's deprecated.json: when every `old` tag matches (`*` matches
 * any value), the old tags are replaced by `replace`, where `$1` stands for the value matched by
 * the first `*`. Without `replace`, the old tags are only removed.
 */
import type { Tags } from "#lib/osm/tags.ts";

export interface UpgradeRule {
	readonly old: Tags;
	readonly replace?: Tags;
	/** Keys that must be missing for the rule to apply (IndoorID's, not iD's format). */
	readonly absent?: readonly string[];
}

/**
 * Indoor upgrades the schema doesn't have: the IndoorOSM `buildingpart=*` scheme and `room=*`
 * used as the main type, to Simple Indoor Tagging (an elevator is `indoor=room` with
 * `highway=elevator`), values that are mistakes for others (`indoor=highway`, `indoor=stairs`)
 * and door tags osm-simple3d-editor found misused. Specific rules come first.
 */
export const LOCAL_UPGRADES: readonly UpgradeRule[] = [
	{
		old: {
			buildingpart: "verticalpassage",
			"buildingpart:verticalpassage": "elevator",
		},
		replace: { indoor: "room", elevator: "yes", highway: "elevator" },
	},
	{
		old: {
			buildingpart: "verticalpassage",
			"buildingpart:verticalpassage": "stairway",
		},
		replace: { indoor: "room", stairs: "yes" },
	},
	{ old: { buildingpart: "verticalpassage" }, replace: { indoor: "room" } },
	{ old: { buildingpart: "room" }, replace: { indoor: "room" } },
	{ old: { buildingpart: "corridor" }, replace: { indoor: "corridor" } },
	{ old: { buildingpart: "hall" }, replace: { indoor: "area" } },
	// `room=*` as the main type (no `indoor`). With `indoor`, `room=stairs|elevator` is the
	// purpose of a room or area, as osm-simple3d-editor writes it: kept.
	{
		old: { room: "stairs" },
		replace: { indoor: "room", stairs: "yes" },
		absent: ["indoor"],
	},
	{
		old: { room: "elevator" },
		replace: { indoor: "room", elevator: "yes", highway: "elevator" },
		absent: ["indoor"],
	},
	// osm-simple3d-editor `831fc28`: a column is indoor=column, not a room (W2).
	{ old: { indoor: "room", room: "column" }, replace: { indoor: "column" } },
	{ old: { indoor: "area", room: "column" }, replace: { indoor: "column" } },
	{ old: { indoor: "highway" }, replace: { indoor: "yes" } },
	{ old: { indoor: "stairs" }, replace: { indoor: "yes" } },
	{
		old: { door: "loadingdock" },
		replace: { door: "yes", amenity: "loading_dock" },
	},
	{ old: { entrance: "gate" }, replace: { barrier: "gate" } },
	{ old: { "addr:entrance": "yes" }, replace: { entrance: "yes" } },
];

/** The tags with every matching rule applied, or the same object when nothing changes. */
export function upgradeTags(tags: Tags, rules: readonly UpgradeRule[]): Tags {
	let result = tags;
	for (const rule of rules) {
		if (!matches(result, rule.old)) continue;
		if (rule.absent?.some((key) => result[key] !== undefined)) continue;
		const wildcard = Object.keys(rule.old).find((k) => rule.old[k] === "*");
		const matched = wildcard === undefined ? "" : (result[wildcard] ?? "");
		const next: Record<string, string> = { ...result };
		for (const key of Object.keys(rule.old)) delete next[key];
		for (const [key, value] of Object.entries(rule.replace ?? {})) {
			next[key] = value.replaceAll("$1", matched);
		}
		result = next;
	}
	return result;
}

function matches(tags: Tags, old: Tags): boolean {
	return Object.entries(old).every(([key, value]) =>
		value === "*" ? tags[key] !== undefined : tags[key] === value,
	);
}

/** "a=1, b=2", for messages. */
export function describeTags(tags: Tags): string {
	return Object.entries(tags)
		.map(([k, v]) => `${k}=${v}`)
		.join(", ");
}
