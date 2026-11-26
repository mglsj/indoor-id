/**
 * Wiki conformance checks from the November research (W2): escalators and stairs as Simple
 * Indoor Tagging draws them, rooms that want an `amenity`, slivers, level outlines much smaller
 * than their building, platforms without a level and nodes drawn twice. Several follow
 * osm-simple3d-editor's `validateEscalators` and validator (ISC); checks that need level
 * heights (an escalator's slope) wait for 3D.3. Each takes one entity and the outlines index,
 * as `validate` does.
 */
import { changeTags } from "#lib/actions/change-tags.ts";
import { connectNodes, connectRefusal } from "#lib/actions/connect.ts";
import { onePerLevelPair } from "#lib/actions/split-levels.ts";
import { msg } from "#lib/i18n/messages.ts";
import { featureLevels } from "#lib/levels/feature-levels.ts";
import {
	isOnLevel,
	type Levels,
	listLevels,
	parseLevels,
} from "#lib/levels/levels.ts";
import type { Entity, Loc, Node, NodeId, Way } from "#lib/osm/entity.ts";
import {
	distanceToSegment,
	isClosed,
	local,
	pointInRing,
	wayLocs,
} from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { Tags } from "#lib/osm/tags.ts";
import type { Outline, Outlines } from "./outlines.ts";
import type { Issue, IssueRule } from "./validate.ts";

export function conformanceIssues(
	graph: Graph,
	entity: Entity,
	outlines: Outlines,
): Issue[] {
	return [
		...flightIssues(graph, entity, outlines),
		...flightOverLevels(graph, entity),
		...roomAmenity(entity),
		...sliver(graph, entity),
		...smallLevelOutline(graph, entity, outlines),
		...platformWithoutLevel(graph, entity, outlines),
		...duplicateNodes(graph, entity, outlines),
	];
}

function issue(
	rule: IssueRule,
	entity: Entity,
	message: Issue["message"],
	{ fix, key, at }: { fix?: Issue["fix"]; key?: string; at?: NodeId } = {},
): Issue {
	return {
		id: `${rule}:${entity.id}${key ? `:${key}` : ""}`,
		rule,
		severity: "warning",
		entityId: entity.id,
		...(at && { at }),
		message,
		...(fix && { fix }),
	};
}

/** An escalator: SIT's `highway=steps` + `conveying=*`. */
function isEscalator(tags: Tags): boolean {
	return (
		tags.highway === "steps" &&
		tags.conveying !== undefined &&
		tags.conveying !== "no"
	);
}

/** Spaces an escalator's end can be in. */
const LANDINGS = new Set(["room", "area", "corridor", "level"]);

/**
 * A flight drawn as a line (SIT: `highway=steps`, with `conveying=*` for an escalator) going
 * from one level to another. An escalator lists both end levels in `level`, says which way is
 * up (`incline=up|down`), is a straight line of two points, and each end lies in a room,
 * corridor, area or level outline of its level. Stairs between levels also need `incline`.
 */
function flightIssues(
	graph: Graph,
	entity: Entity,
	outlines: Outlines,
): Issue[] {
	if (entity.type !== "way" || isClosed(entity)) return [];
	const { tags } = entity;
	if (tags.highway !== "steps" || tags.level === undefined) return [];
	const levels = listLevels(tags.level);
	if (!levels) return []; // unreadable-level says so
	const escalator = isEscalator(tags);
	const issues: Issue[] = [];
	if (escalator && levels.length < 2) {
		issues.push(
			issue("escalator-levels", entity, msg("issue_escalator_levels")),
		);
	}
	const incline = tags.incline;
	const knownIncline = incline === "up" || incline === "down";
	if ((escalator || levels.length >= 2) && !knownIncline) {
		issues.push(issue("flight-incline", entity, msg("issue_flight_incline")));
	}
	if (escalator && entity.nodes.length > 2) {
		issues.push(issue("escalator-shape", entity, msg("issue_escalator_shape")));
	}
	const [low, high] = [levels[0], levels.at(-1)];
	if (
		escalator &&
		knownIncline &&
		levels.length === 2 &&
		low !== undefined &&
		high !== undefined
	) {
		const first = entity.nodes[0];
		const last = entity.nodes.at(-1);
		const ends: [NodeId | undefined, number][] =
			incline === "up"
				? [
						[first, low],
						[last, high],
					]
				: [
						[first, high],
						[last, low],
					];
		for (const [id, level] of ends) {
			const end = id && graph.entity(id);
			if (end?.type !== "node") continue;
			const spaces = outlines
				.at(end.loc)
				.filter((o) => o.indoor && LANDINGS.has(o.indoor));
			// Nothing mapped there yet, on any level: nothing to compare with.
			if (spaces.length === 0) continue;
			if (spaces.some((o) => o.levels && isOnLevel(o.levels, level))) continue;
			issues.push(
				issue(
					"escalator-end",
					entity,
					msg("issue_escalator_end", { level: String(level) }),
					{ key: end.id, at: end.id },
				),
			);
		}
	}
	return issues;
}

/**
 * Stairs or an escalator (not a stairwell, which does span every floor) with three or more
 * levels in `level`: a flight joins two adjacent levels. A drawn area is fixed by one copy per
 * pair, sharing its nodes; a line has to be drawn again for each flight, so it gets no fix.
 */
function flightOverLevels(graph: Graph, entity: Entity): Issue[] {
	if (entity.type !== "way") return [];
	const { tags } = entity;
	if (tags.highway !== "steps" && !isEscalator(tags)) return [];
	if (tags.level === undefined) return [];
	const levels = listLevels(tags.level);
	if (!levels || levels.length < 3) return [];
	const fixable =
		isClosed(entity) && graph.parentRelations(entity.id).length === 0;
	return [
		issue(
			"flight-over-levels",
			entity,
			msg("issue_flight_over_levels", { level: tags.level }),
			fixable
				? {
						fix: {
							label: msg("fix_flight_per_pair", { count: levels.length - 1 }),
							action: onePerLevelPair(entity.id, levels),
						},
					}
				: {},
		),
	];
}

/** Room types the wiki maps with an `amenity` of their own. */
const ROOM_AMENITIES: Readonly<Record<string, string>> = {
	reception: "reception_desk",
	dressing: "dressing_room",
};

/** `room=reception` without `amenity=reception_desk`, `room=dressing` without `dressing_room`. */
function roomAmenity(entity: Entity): Issue[] {
	const room = entity.tags.room;
	const amenity = room === undefined ? undefined : ROOM_AMENITIES[room];
	if (!room || !amenity || entity.tags.amenity !== undefined) return [];
	return [
		issue(
			"room-amenity",
			entity,
			msg("issue_room_amenity", { room, amenity }),
			{
				fix: {
					label: msg("fix_add_amenity", { amenity }),
					action: changeTags(entity.id, { ...entity.tags, amenity }),
				},
			},
		),
	];
}

/** Closed indoor ways that outline something solid or a space. */
const SHAPES = new Set(["room", "area", "corridor", "level", "column"]);
/** A ring whose mean width is under this (metres) may be a sliver… */
const SLIVER_WIDTH = 0.05;
/** …when that width is also under this share of its length: a small post isn't one. */
const SLIVER_RATIO = 0.1;

/**
 * A room, area, corridor, level outline, column or wall area that has almost no width: a
 * drawing slip, often left by cutting or snapping. Only rings narrow for their size count
 * (osm-simple3d-editor `bc06c32`): a 6 × 6 cm post is small, not degenerate.
 */
function sliver(graph: Graph, entity: Entity): Issue[] {
	if (entity.type !== "way" || !isClosed(entity)) return [];
	const { indoor, area } = entity.tags;
	const wallArea = indoor === "wall" && area === "yes";
	if (!wallArea && !SHAPES.has(indoor ?? "")) return [];
	const locs = wayLocs(graph, entity);
	if (locs.length !== entity.nodes.length) return []; // not all downloaded
	const { area: surface, perimeter } = ringMeasures(locs);
	if (perimeter === 0) return [issue("sliver", entity, msg("issue_sliver"))];
	const width = (2 * surface) / perimeter;
	const length = perimeter / 2;
	if (width >= SLIVER_WIDTH || width >= SLIVER_RATIO * length) return [];
	return [issue("sliver", entity, msg("issue_sliver"))];
}

/** A ring's area (m²) and perimeter (m), flat around its first point. */
function ringMeasures(ring: readonly Loc[]): {
	area: number;
	perimeter: number;
} {
	const origin = ring[0];
	if (!origin) return { area: 0, perimeter: 0 };
	const points = ring.map((loc) => local(origin, loc));
	let twice = 0;
	let perimeter = 0;
	for (let i = 1; i < points.length; i++) {
		const [ax = 0, ay = 0] = points[i - 1] ?? [];
		const [bx = 0, by = 0] = points[i] ?? [];
		twice += ax * by - bx * ay;
		perimeter += Math.hypot(bx - ax, by - ay);
	}
	return { area: Math.abs(twice) / 2, perimeter };
}

/** A level outline covering less than this share of its building is flagged. */
const SMALL_LEVEL = 0.5;

/**
 * An `indoor=level` outline much smaller than the building at that level (forum t/148767
 * #114): 3D draws the rest of the floor as a hole. The building at a level is its building
 * parts that reach that level, when it has parts, else its outline. A hint: a level can be
 * smaller (a mezzanine), but more often it was drawn for part of the floor only.
 */
function smallLevelOutline(
	graph: Graph,
	entity: Entity,
	outlines: Outlines,
): Issue[] {
	if (entity.type !== "way" || entity.tags.indoor !== "level") return [];
	const self = outlines.get(entity.id);
	if (!self?.levels || self.building) return [];
	const centre = ringCentre(self.ring);
	if (!centre) return [];
	const building = outlines
		.at(centre)
		.filter((o) => o.building && o.id !== entity.id)
		.sort((a, b) => ringMeasures(a.ring).area - ringMeasures(b.ring).area)[0];
	if (!building) return [];
	const parts = outlines
		.within(building.extent)
		.filter((o) => o.part && insideRing(o.ring, building.ring));
	let covered: number;
	if (parts.length === 0) covered = ringMeasures(building.ring).area;
	else {
		const levels = self.levels;
		const atLevel = parts.filter((o) => {
			const part = graph.entity(o.id);
			const partLevels = part && partLevelsOf(part.tags);
			return partLevels && overlap(partLevels, levels);
		});
		if (atLevel.length === 0) return [];
		covered = atLevel.reduce((sum, o) => sum + ringMeasures(o.ring).area, 0);
	}
	const own = ringMeasures(self.ring).area;
	if (covered <= 0 || own >= SMALL_LEVEL * covered) return [];
	return [
		issue(
			"small-level-outline",
			entity,
			msg("issue_small_level_outline", {
				percent: Math.round((own / covered) * 100),
			}),
		),
	];
}

/** A building part's levels: its `building:levels`, from `building:min_level` up. */
function partLevelsOf(tags: Tags): Levels | null {
	const levels = featureLevels(tags);
	const min = Number(tags["building:min_level"]);
	if (
		!levels ||
		!Number.isFinite(min) ||
		tags["building:min_level"] === undefined
	)
		return levels;
	return levels
		.filter((l) => l.max >= min)
		.map((l) => ({ min: Math.max(l.min, min), max: l.max }));
}

function overlap(a: Levels, b: Levels): boolean {
	return a.some((x) => b.some((y) => x.min <= y.max && y.min <= x.max));
}

function ringCentre(ring: readonly Loc[]): Loc | null {
	const corners = ring.slice(0, -1);
	if (corners.length === 0) return null;
	return [0, 1].map(
		(i) =>
			corners.reduce((sum, loc) => sum + (loc[i] ?? 0), 0) / corners.length,
	) as unknown as Loc;
}

function insideRing(ring: readonly Loc[], outer: readonly Loc[]): boolean {
	const centre = ringCentre(ring);
	return centre !== null && pointInRing(centre, outer);
}

/** Where a way is (the mean of its corners) or a point is. */
function centreOf(graph: Graph, entity: Node | Way): Loc | null {
	if (entity.type === "node") return entity.loc;
	const locs = wayLocs(graph, entity);
	return isClosed(entity)
		? ringCentre(locs)
		: ringCentre([...locs, locs[0] as Loc]);
}

/**
 * A `railway=platform` inside a building with no level (osm-simple3d-editor): an indoor
 * station's platform then shows on every level. The fix puts it on level 0, as most are; an
 * `indoor=*` platform is left to `missing-level`, whose fix takes the level shown.
 */
function platformWithoutLevel(
	graph: Graph,
	entity: Entity,
	outlines: Outlines,
): Issue[] {
	const { tags } = entity;
	if (tags.railway !== "platform" || entity.type === "relation") return [];
	if (tags.indoor !== undefined && tags.indoor !== "no") return [];
	if (entity.type === "node" && graph.parentWays(entity.id).length > 0)
		return [];
	const levels = featureLevels(tags, () =>
		graph.parentRelations(entity.id).map((r) => r.tags),
	);
	if (levels || tags.level !== undefined || tags.repeat_on !== undefined)
		return [];
	const centre = centreOf(graph, entity);
	if (!centre) return [];
	if (!outlines.at(centre).some((o) => o.building && o.id !== entity.id))
		return [];
	return [
		issue("platform-no-level", entity, msg("issue_platform_no_level"), {
			fix: {
				label: msg("fix_set_level", { level: "0" }),
				action: changeTags(entity.id, { ...tags, level: "0" }),
			},
		}),
	];
}

/** Two nodes this close (metres) are on the same spot. */
const SAME_SPOT = 0.01;

/**
 * A corner of an indoor outline or building on the same spot as a corner of another, on the
 * same level, without being joined (forum t/148767 #139, which Osmose reports): 3D and routing
 * see two outlines that only touch. The fix merges them. Reported once per pair, on the way
 * holding the node with the larger id. Different levels may keep nodes of their own: a copy
 * of a room on the floor above is not a duplicate.
 */
function duplicateNodes(
	graph: Graph,
	entity: Entity,
	outlines: Outlines,
): Issue[] {
	if (entity.type !== "way") return [];
	const self = outlines.get(entity.id);
	if (!self) return [];
	const levels = outlineLevels(self);
	const own = new Set(entity.nodes);
	const issues: Issue[] = [];
	for (const id of own) {
		const node = graph.entity(id);
		if (node?.type !== "node") continue;
		for (const other of outlines.near(node.loc, SAME_SPOT)) {
			if (other.id === entity.id) continue;
			const otherLevels = outlineLevels(other);
			if (levels && otherLevels && !overlap(levels, otherLevels)) continue;
			const way = graph.entity(other.id);
			if (way?.type !== "way") continue;
			const twin = way.nodes
				.filter((n) => !own.has(n) && n < id)
				.map((n) => graph.entity(n))
				.find(
					(n): n is Node =>
						n?.type === "node" &&
						distanceToSegment(node.loc, n.loc, n.loc) < SAME_SPOT,
				);
			if (!twin) continue;
			const refused = connectRefusal(graph, id, twin.id);
			issues.push(
				issue("duplicate-node", entity, msg("issue_duplicate_node"), {
					key: id,
					at: id,
					...(!refused && {
						fix: {
							label: msg("fix_merge_nodes"),
							action: connectNodes(id, twin.id),
						},
					}),
				}),
			);
			break;
		}
	}
	return issues;
}

/** The levels an outline is on: a building's or part's is the ground floor, as drawn. */
function outlineLevels(outline: Outline): Levels | null {
	if (outline.levels) return outline.levels;
	if (outline.building || outline.part) return parseLevels("0");
	return null;
}
