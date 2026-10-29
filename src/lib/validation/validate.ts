/**
 * Checks entities for tagging problems. Each issue may carry a fix: a graph action, applied
 * through the history like any edit (so it can be undone).
 */
import { changeTags } from "#lib/actions/change-tags.ts";
import { onePerLevel } from "#lib/actions/split-levels.ts";
import { type Message, msg } from "#lib/i18n/messages.ts";
import { featureLevels, unionOfLevels } from "#lib/levels/feature-levels.ts";
import { explicitLevels } from "#lib/levels/level-names.ts";
import {
	formatLevels,
	isOnLevel,
	type Levels,
	normalizeLevels,
	parseLevels,
} from "#lib/levels/levels.ts";
import type { Entity, EntityId, Loc, Node, Way } from "#lib/osm/entity.ts";
import { isClosed, pointInRing, wayLocs } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";
import type { Tags } from "#lib/osm/tags.ts";
import { Outlines } from "./outlines.ts";
import { spatialIssues } from "./spatial.ts";
import { describeTags, type UpgradeRule, upgradeTags } from "./upgrades.ts";

export type IssueRule =
	| "outdated-tags"
	| "unreadable-level"
	| "vertical-repeat-on"
	| "door-not-on-wall"
	| "room-not-indoor"
	| "building-part-indoor"
	| "unknown-inside"
	| "door-without-type"
	| "building-passage-level"
	| "opening-on-several-levels"
	| "missing-level"
	| "outer-door-no-entrance"
	| "entrance-inside"
	| "one-based-levels"
	| "non-existent-level"
	| "room-on-several-levels"
	| "empty-tag"
	| "level-outside-building"
	| "no-level-outline"
	| "almost-joined"
	| "crossing-rooms"
	| "unsquare-room"
	| "close-nodes"
	| "disconnected-path"
	| "open-multipolygon";

/** Rules whose issues the upload refuses: the server would take broken data. */
export const BLOCKING_RULES: ReadonlySet<IssueRule> = new Set([
	"open-multipolygon",
]);

export interface Issue {
	/** Stable id, `rule:entity`. */
	readonly id: string;
	readonly rule: IssueRule;
	readonly severity: "warning" | "error";
	readonly entityId: EntityId;
	readonly message: Message;
	readonly fix?: Fix;
	/** A fix that takes the level shown on the map (`missing-level`). */
	readonly levelFix?: (level: number) => Fix;
}

export interface Fix {
	readonly label: Message;
	readonly action: Action;
}

/**
 * The issues of the entities `ids`. Checks that depend on where a feature is use `outlines`
 * (by default indexed from `graph`; the `Validator` keeps one up to date).
 */
export function validate(
	graph: Graph,
	ids: Iterable<EntityId>,
	upgrades: readonly UpgradeRule[],
	outlines: Outlines = Outlines.of(graph),
): Issue[] {
	const issues: Issue[] = [];
	for (const id of ids) {
		const entity = graph.entity(id);
		if (!entity) continue;
		issues.push(
			...outdatedTags(entity, upgrades),
			...tagIssues(entity, upgradeTags(entity.tags, upgrades)),
			...levelIssues(entity),
			...openingIssues(entity),
			...roomOnSeveralLevels(graph, entity),
			...doorIssues(graph, entity, outlines),
			...missingLevel(graph, entity, outlines),
			...oneBasedLevels(entity, outlines),
			...nonExistentLevel(graph, entity, outlines),
			...spatialIssues(graph, entity, outlines),
			...openMultipolygon(graph, entity),
		);
	}
	return issues;
}

/** An issue; `key` tells apart issues of one rule on one entity (`level` and `repeat_on`). */
function issue(
	rule: IssueRule,
	entity: Entity,
	message: Message,
	fix?: Fix,
	key?: string,
): Issue {
	return {
		id: `${rule}:${entity.id}${key ? `:${key}` : ""}`,
		rule,
		severity: "warning",
		entityId: entity.id,
		message,
		fix,
	};
}

function outdatedTags(
	entity: Entity,
	upgrades: readonly UpgradeRule[],
): Issue[] {
	const upgraded = upgradeTags(entity.tags, upgrades);
	if (upgraded === entity.tags) return [];
	const removed = only(entity.tags, (k) => upgraded[k] !== entity.tags[k]);
	const added = only(upgraded, (k) => upgraded[k] !== entity.tags[k]);
	return [
		issue(
			"outdated-tags",
			entity,
			msg("issue_outdated_tags", { tags: describeTags(removed) }),
			{
				label: Object.keys(added).length
					? msg("fix_upgrade_tags", { tags: describeTags(added) })
					: msg("fix_remove_tags", { tags: describeTags(removed) }),
				action: changeTags(entity.id, upgraded),
			},
		),
	];
}

const VERTICAL_HIGHWAYS = new Set(["elevator", "steps"]);

/** Stairs, elevators and escalators span levels rather than repeat on them. */
function isVertical(tags: Tags): boolean {
	return (
		tags.stairs === "yes" ||
		tags.elevator === "yes" ||
		(tags.highway !== undefined && VERTICAL_HIGHWAYS.has(tags.highway)) ||
		tags.conveying !== undefined
	);
}

function levelIssues(entity: Entity): Issue[] {
	const issues: Issue[] = [];
	for (const key of ["level", "repeat_on"] as const) {
		const value = entity.tags[key];
		if (value === undefined || parseLevels(value)) continue;
		issues.push(
			issue(
				"unreadable-level",
				entity,
				msg(
					value.includes(",")
						? "issue_unreadable_level_comma"
						: "issue_unreadable_level",
					{ key, value },
				),
				undefined,
				key,
			),
		);
	}

	const level =
		entity.tags.level === undefined ? [] : parseLevels(entity.tags.level);
	const repeatOn = entity.tags.repeat_on
		? parseLevels(entity.tags.repeat_on)
		: null;
	// SIT: a stair or elevator door is one node with repeat_on, not a level list.
	const opening =
		entity.tags.door !== undefined || entity.tags.entrance !== undefined;
	if (isVertical(entity.tags) && !opening && level && repeatOn) {
		const { repeat_on: _, ...rest } = entity.tags;
		const tags = {
			...rest,
			level: formatLevels(normalizeLevels([...level, ...repeatOn])),
		};
		issues.push(
			issue("vertical-repeat-on", entity, msg("issue_vertical_repeat_on"), {
				label: msg("fix_set_level", { level: tags.level }),
				action: changeTags(entity.id, tags),
			}),
		);
	}
	return issues;
}

/** How far from the building's outline a door counts as on its outer wall (W). */
const OUTER_WALL_METRES = 0.3;
/** How far inside the building an entrance can be before it is an indoor door. */
const ENTRANCE_METRES = 0.5;

function doorIssues(graph: Graph, entity: Entity, outlines: Outlines): Issue[] {
	if (entity.type !== "node") return [];
	const { tags } = entity;
	const isDoor = tags.door !== undefined || tags.indoor === "door";
	const issues: Issue[] = [];
	if (tags.door !== undefined) {
		const ways = graph.parentWays(entity.id);
		if (ways.length === 0) {
			issues.push(
				issue("door-not-on-wall", entity, msg("issue_door_not_on_wall")),
			);
		} else if (ways.every(isWallArea)) {
			// SIT puts doors on wall lines: routing can't go through an area.
			issues.push(
				issue("door-not-on-wall", entity, msg("issue_door_on_wall_area")),
			);
		}
	}
	if (isDoor && tags.entrance === undefined) {
		const levels = nodeLevels(graph, entity);
		const outer = outlines
			.near(entity.loc, OUTER_WALL_METRES)
			.some(
				(o) =>
					o.building ||
					(o.indoor === "level" &&
						(!levels || !o.levels || overlap(levels, o.levels))),
			);
		if (outer) {
			issues.push(
				issue(
					"outer-door-no-entrance",
					entity,
					msg("issue_outer_door_no_entrance"),
					{
						label: msg("fix_add_entrance_yes"),
						action: changeTags(entity.id, { ...tags, entrance: "yes" }),
					},
				),
			);
		}
	}
	if (tags.entrance === "yes" && isInsideBuilding(entity.loc, outlines)) {
		const { entrance: _, ...rest } = tags;
		const door = tags.door ?? "yes";
		issues.push(
			issue("entrance-inside", entity, msg("issue_entrance_inside"), {
				label: msg("fix_entrance_to_door", { door }),
				action: changeTags(entity.id, { ...rest, indoor: "door", door }),
			}),
		);
	}
	return issues;
}

/** A closed `indoor=wall` drawn as an area (the wall preset is a line). */
function isWallArea(way: Way): boolean {
	return way.tags.indoor === "wall" && way.tags.area === "yes" && isClosed(way);
}

/** Inside a building, and more than `ENTRANCE_METRES` from every building's outline. */
function isInsideBuilding(loc: Loc, outlines: Outlines): boolean {
	return (
		outlines.at(loc).some((o) => o.building) &&
		!outlines.near(loc, ENTRANCE_METRES).some((o) => o.building)
	);
}

/** A node's own levels, or those of its ways (a door takes its wall's). */
function nodeLevels(graph: Graph, node: Node): Levels | null {
	return (
		featureLevels(node.tags) ??
		unionOfLevels(graph.parentWays(node.id).map((w) => featureLevels(w.tags)))
	);
}

function overlap(a: Levels, b: Levels): boolean {
	return a.some((x) => b.some((y) => x.min <= y.max && y.min <= x.max));
}

/** Whether the tags place a feature on a level (unreadable values have their own issue). */
function hasLevel(graph: Graph, entity: Entity): boolean {
	const { tags } = entity;
	return (
		tags.level !== undefined ||
		tags.repeat_on !== undefined ||
		(tags.min_level !== undefined && tags.max_level !== undefined) ||
		graph
			.parentRelations(entity.id)
			.some(
				(r) =>
					(r.tags.type === "multipolygon" || r.tags.type === "level") &&
					r.tags.level !== undefined,
			)
	);
}

/**
 * An indoor feature, or a point inside an indoor outline, without a level: it shows on every
 * level. A vertex is left to its ways' levels. The fix takes the level shown.
 */
function missingLevel(
	graph: Graph,
	entity: Entity,
	outlines: Outlines,
): Issue[] {
	const { tags } = entity;
	if (hasLevel(graph, entity)) return [];
	const indoor = tags.indoor !== undefined && tags.indoor !== "no";
	if (!indoor) {
		if (entity.type !== "node" || Object.keys(tags).length === 0) return [];
		if (graph.parentWays(entity.id).length > 0) return [];
		if (!outlines.at(entity.loc).some((o) => o.indoor)) return [];
	} else if (
		entity.type === "node" &&
		graph.parentWays(entity.id).some((w) => hasLevel(graph, w))
	) {
		return [];
	}
	return [
		{
			...issue("missing-level", entity, msg("issue_missing_level")),
			levelFix: (level) => {
				const value = String(level);
				return {
					label: msg("fix_set_level", { level: value }),
					action: changeTags(entity.id, { ...tags, level: value }),
				};
			},
		},
	];
}

/**
 * A building whose indoor outlines have no level 0 and reach above `building:levels`: its
 * levels may be numbered from 1. A hint only, as some countries count from 1.
 */
function oneBasedLevels(entity: Entity, outlines: Outlines): Issue[] {
	const count = Number(entity.tags["building:levels"]);
	if (entity.type !== "way" || !Number.isInteger(count) || count < 1) return [];
	const self = outlines.get(entity.id);
	if (!self?.building) return [];
	const levels = outlines
		.within(self.extent)
		.filter((o) => o.indoor && o.levels && inside(o.ring, self.ring))
		.flatMap((o) => o.levels ?? []);
	if (levels.length === 0) return [];
	if (isOnLevel(levels, 0)) return [];
	if (Math.max(...levels.map((l) => l.max)) < count) return [];
	return [
		issue("one-based-levels", entity, msg("issue_one_based_levels", { count })),
	];
}

/**
 * A feature in a building that names a level the building's `non_existent_levels` skips:
 * the switcher doesn't list that level, so the level is probably wrong. No fix: which level
 * was meant is unknown.
 */
function nonExistentLevel(
	graph: Graph,
	entity: Entity,
	outlines: Outlines,
): Issue[] {
	const levels = explicitLevels(entity.tags);
	if (levels.length === 0 || entity.type === "relation") return [];
	const locs = entity.type === "node" ? [entity.loc] : wayLocs(graph, entity);
	const corners =
		entity.type === "way" && isClosed(entity) ? locs.slice(0, -1) : locs;
	if (corners.length === 0) return [];
	const centre = [0, 1].map(
		(i) =>
			corners.reduce((sum, loc) => sum + (loc[i] ?? 0), 0) / corners.length,
	);
	const skipped = outlines
		.at(centre)
		.filter((o) => o.building && o.nonExistent && o.id !== entity.id)
		.flatMap((o) => levels.filter((l) => isOnLevel(o.nonExistent ?? [], l)));
	const level = [...new Set(skipped)].sort((a, b) => a - b).join(";");
	if (!level) return [];
	return [
		issue(
			"non-existent-level",
			entity,
			msg("issue_non_existent_level", { level }),
		),
	];
}

/** Whether a ring's centre (the mean of its corners) is inside another ring. */
function inside(ring: readonly Loc[], outer: readonly Loc[]): boolean {
	const corners = ring.slice(0, -1);
	const centre = [0, 1].map(
		(i) =>
			corners.reduce((sum, loc) => sum + (loc[i] ?? 0), 0) / corners.length,
	);
	return pointInRing(centre, outer);
}

const ROOM_SPACES = new Set(["room", "area", "corridor"]);

/**
 * Indoor tagging mistakes (osm-simple3d-editor's `validateIndoor`), checked on the tags as the
 * upgrades leave them, so that `room=stairs` is only reported as outdated.
 */
function tagIssues(entity: Entity, tags: Tags): Issue[] {
	const issues: Issue[] = [];
	const indoor = tags.indoor;
	const room = tags.room;
	if (room !== undefined && !(indoor && ROOM_SPACES.has(indoor))) {
		if (indoor === "wall" || indoor === "column") {
			issues.push(
				issue(
					"room-not-indoor",
					entity,
					msg("issue_room_on_wall", { indoor, value: room }),
				),
			);
		} else {
			issues.push(
				issue(
					"room-not-indoor",
					entity,
					msg("issue_room_not_indoor", { value: room }),
					indoor === undefined
						? {
								label: msg("fix_add_indoor_room"),
								action: changeTags(entity.id, {
									indoor: "room",
									...entity.tags,
								}),
							}
						: undefined,
				),
			);
		}
	}
	if (
		tags["building:part"] !== undefined &&
		indoor &&
		ROOM_SPACES.has(indoor)
	) {
		issues.push(
			issue("building-part-indoor", entity, msg("issue_building_part_indoor")),
		);
	}
	if (tags.inside !== undefined) {
		issues.push(issue("unknown-inside", entity, msg("issue_unknown_inside")));
	}
	if (indoor === "door" && tags.door === undefined) {
		issues.push(
			issue("door-without-type", entity, msg("issue_door_without_type"), {
				label: msg("fix_add_door_yes"),
				action: changeTags(entity.id, { ...entity.tags, door: "yes" }),
			}),
		);
	}
	if (tags.tunnel === "building_passage" && tags.level !== undefined) {
		issues.push(
			issue(
				"building-passage-level",
				entity,
				msg("issue_building_passage_level"),
			),
		);
	}
	return issues;
}

/** Keys of a point that is on one level, repeated on others (SIT's vertical connections). */
const OPENINGS = ["door", "entrance", "window", "emergency"];

/**
 * A door, entrance, window or emergency point with several levels in `level`: the lowest stays
 * in `level`, the others go to `repeat_on`. Left alone when a range can't be listed (`0-0.5`).
 */
function openingIssues(entity: Entity): Issue[] {
	const { level, repeat_on: repeatOn } = entity.tags;
	if (!OPENINGS.some((key) => entity.tags[key] !== undefined)) return [];
	const levels = level === undefined ? null : listLevels(level);
	if (!levels || levels.length < 2) return [];
	const [lowest, ...others] = levels;
	const repeated =
		repeatOn === undefined ? [] : (parseLevels(repeatOn) ?? null);
	if (repeated === null) return [];
	const tags = {
		...entity.tags,
		level: String(lowest),
		repeat_on: formatLevels(
			normalizeLevels([
				...others.map((l) => ({ min: l, max: l })),
				...repeated,
			]),
		),
	};
	return [
		issue(
			"opening-on-several-levels",
			entity,
			msg("issue_opening_on_several_levels"),
			{
				label: msg("fix_set_level_repeat_on", {
					level: tags.level,
					repeat_on: tags.repeat_on,
				}),
				action: changeTags(entity.id, tags),
			},
		),
	];
}

/** Indoor spaces that are a room on each level when tagged with several. */
const SPACES = new Set(["room", "area", "corridor"]);
/** Rooms that do span levels. */
const SPANNING_ROOMS = new Set(["stairs", "elevator", "atrium", "shaft"]);

/**
 * A room, area or corridor with a list of levels in `level`: right for a space that spans them
 * (an atrium, a hall: the message says so), but often one room per level mapped once. The fix
 * makes one per level, sharing its nodes. Left alone: stairs, elevators and atriums, a room
 * also in `repeat_on`, a way in a relation (its copies wouldn't be members), ranges of
 * non-whole levels.
 */
function roomOnSeveralLevels(graph: Graph, entity: Entity): Issue[] {
	const { tags } = entity;
	if (entity.type !== "way" || !isClosed(entity)) return [];
	if (!SPACES.has(tags.indoor ?? "") || tags.repeat_on !== undefined) return [];
	if (isVertical(tags) || SPANNING_ROOMS.has(tags.room ?? "")) return [];
	if (tags.level === undefined || graph.parentRelations(entity.id).length > 0)
		return [];
	const levels = listLevels(tags.level);
	if (!levels || levels.length < 2) return [];
	return [
		issue(
			"room-on-several-levels",
			entity,
			msg("issue_room_on_several_levels", {
				indoor: tags.indoor ?? "room",
				level: tags.level,
			}),
			{
				label: msg("fix_room_per_level", { count: levels.length }),
				action: onePerLevel(entity.id, levels),
			},
		),
	];
}

/** Every level of a value, sorted, with ranges of whole levels listed; null if it can't be. */
function listLevels(value: string): number[] | null {
	const ranges = parseLevels(value);
	if (!ranges) return null;
	const levels: number[] = [];
	for (const { min, max } of ranges) {
		if (min === max) levels.push(min);
		else if (Number.isInteger(min) && Number.isInteger(max)) {
			for (let l = min; l <= max; l++) levels.push(l);
		} else return null;
	}
	return levels;
}

function only(tags: Tags, keep: (key: string) => boolean): Tags {
	return Object.fromEntries(Object.entries(tags).filter(([k]) => keep(k)));
}

/**
 * A multipolygon whose ways don't close into rings: every end of a way that isn't closed must
 * meet the end of another member way. Only judged when all its ways are downloaded.
 */
function openMultipolygon(graph: Graph, entity: Entity): Issue[] {
	if (entity.type !== "relation" || entity.tags.type !== "multipolygon")
		return [];
	const ends = new Map<string, number>();
	for (const member of entity.members) {
		if (member.ref[0] !== "w") continue;
		const way = graph.entity(member.ref);
		if (way?.type !== "way") return [];
		if (isClosed(way)) continue;
		for (const end of [way.nodes[0], way.nodes.at(-1)]) {
			if (end) ends.set(end, (ends.get(end) ?? 0) + 1);
		}
	}
	return [...ends.values()].some((n) => n % 2 === 1)
		? [
				{
					...issue("open-multipolygon", entity, msg("issue_open_multipolygon")),
					severity: "error",
				},
			]
		: [];
}
