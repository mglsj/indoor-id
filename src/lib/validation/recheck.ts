/**
 * Indoor checks from the 2026-11-24 recheck (W3): a wall mapped both as a line and as an area,
 * digitising jitter on an outline, and a door lying on a side without being in it. They follow
 * osm-simple3d-editor's validator (ISC: `ea67cb1`, `render/jitter.ts`, `fe416c4`). Each takes
 * one entity and the outlines index, as `validate` does.
 */
import { changeTags } from "#lib/actions/change-tags.ts";
import { deleteEntities } from "#lib/actions/delete.ts";
import { msg } from "#lib/i18n/messages.ts";
import { featureLevels, unionOfLevels } from "#lib/levels/feature-levels.ts";
import { type Levels, parseLevels } from "#lib/levels/levels.ts";
import type { Entity, Loc, Node, NodeId, Way } from "#lib/osm/entity.ts";
import {
	distanceToLine,
	isClosed,
	local,
	midpoint,
	wayLocs,
} from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import { hasInterestingTags } from "#lib/osm/tags.ts";
import type { Outline, Outlines } from "./outlines.ts";
import { joinFix } from "./spatial.ts";
import type { Issue, IssueRule } from "./validate.ts";

export function recheckIssues(
	graph: Graph,
	entity: Entity,
	outlines: Outlines,
): Issue[] {
	return [
		...wallTwice(graph, entity),
		...jitter(graph, entity),
		...doorOnSide(graph, entity, outlines),
		...highwayRing(graph, entity),
	];
}

/** Walkable lines that never run round a room's outline (an area of them has `area=yes`). */
const RING_HIGHWAYS = new Set(["steps", "footway", "corridor", "path"]);
const SPACES = new Set(["room", "area", "corridor"]);

/**
 * A closed path way on exactly the nodes of an indoor space's outline: a `highway=steps` or
 * footway ring along a room's walls is "grossly wrong" (Tordanik, forum t/138694), a copy of the
 * outline rather than a way through the space. The fix deletes the ring when no relation holds
 * it; its nodes stay in the room.
 */
function highwayRing(graph: Graph, entity: Entity): Issue[] {
	if (entity.type !== "way" || !isClosed(entity)) return [];
	const { highway } = entity.tags;
	if (!highway || !RING_HIGHWAYS.has(highway) || entity.tags.area === "yes") {
		return [];
	}
	const nodes = new Set(entity.nodes);
	const [first] = entity.nodes;
	if (first === undefined || nodes.size < 3) return [];
	const space = graph
		.parentWays(first)
		.find(
			(w) =>
				w.id !== entity.id &&
				isClosed(w) &&
				w.tags.indoor !== undefined &&
				SPACES.has(w.tags.indoor) &&
				new Set(w.nodes).size === nodes.size &&
				w.nodes.every((n) => nodes.has(n)),
		);
	if (!space) return [];
	const held = graph.parentRelations(entity.id).length > 0;
	return [
		issue("highway-ring", entity, msg("issue_highway_ring", { highway }), {
			key: space.id,
			...(!held && {
				fix: {
					label: msg("fix_delete_feature"),
					action: deleteEntities([entity.id]),
				},
			}),
		}),
	];
}

function issue(
	rule: IssueRule,
	entity: Entity,
	message: Issue["message"],
	{ fix, key }: { fix?: Issue["fix"]; key?: string } = {},
): Issue {
	return {
		id: `${rule}:${entity.id}${key ? `:${key}` : ""}`,
		rule,
		severity: "warning",
		entityId: entity.id,
		message,
		...(fix && { fix }),
	};
}

function overlap(a: Levels | null, b: Levels | null): boolean {
	if (!a || !b) return true;
	return a.some((x) => b.some((y) => x.min <= y.max && y.min <= x.max));
}

/** A wall drawn as a line: `indoor=wall` without `area=yes` (forum: closed is still a line). */
function isWallLine(way: Way): boolean {
	return way.tags.indoor === "wall" && way.tags.area !== "yes";
}

/** A line this close (metres) to an outline, all along, runs on it. */
const ON_OUTLINE = 0.05;
/** Keys that make a way a wall; removed when the line is a copy of a wall area's side. */
const WALL_KEYS = [
	"indoor",
	"level",
	"repeat_on",
	"wall",
	"height",
	"min_height",
	"material",
	"colour",
];

/**
 * A wall line lying on the outline of a wall area (`indoor=wall` + `area=yes`, or a wall
 * multipolygon) on the same levels (osm-simple3d-editor `ea67cb1`): one wall mapped twice. The
 * area is found through a node they share, as drawing along a wall snaps to it. The fix removes
 * the line's wall keys, deleting it when nothing else is left.
 */
function wallTwice(graph: Graph, entity: Entity): Issue[] {
	if (entity.type !== "way" || !isWallLine(entity)) return [];
	const locs = wayLocs(graph, entity);
	if (locs.length !== entity.nodes.length || locs.length < 2) return [];
	const levels = featureLevels(entity.tags);
	const area = wallAreasAround(graph, entity).find(
		({ rings, levels: other }) =>
			overlap(levels, other) && runsAlong(locs, rings),
	);
	if (!area) return [];
	const kept: Record<string, string> = {};
	for (const [k, v] of Object.entries(entity.tags)) {
		if (!WALL_KEYS.includes(k)) kept[k] = v;
	}
	const used = graph.parentRelations(entity.id).length > 0;
	const action =
		hasInterestingTags(kept) || used
			? changeTags(entity.id, kept)
			: deleteEntities([entity.id]);
	return [
		issue("wall-twice", entity, msg("issue_wall_twice"), {
			key: area.id,
			fix: { label: msg("fix_remove_wall_line"), action },
		}),
	];
}

interface WallArea {
	readonly id: string;
	readonly rings: readonly (readonly Loc[])[];
	readonly levels: Levels | null;
}

/** The wall areas sharing a node with `line`: closed ways and multipolygons. */
function wallAreasAround(graph: Graph, line: Way): WallArea[] {
	const found = new Map<string, WallArea>();
	for (const id of new Set(line.nodes)) {
		for (const way of graph.parentWays(id)) {
			if (way.id === line.id || found.has(way.id)) continue;
			if (
				way.tags.indoor === "wall" &&
				way.tags.area === "yes" &&
				isClosed(way)
			) {
				found.set(way.id, {
					id: way.id,
					rings: [wayLocs(graph, way)],
					levels: featureLevels(way.tags),
				});
			}
			for (const relation of graph.parentRelations(way.id)) {
				if (found.has(relation.id)) continue;
				const { tags } = relation;
				if (tags.type !== "multipolygon" || tags.indoor !== "wall") continue;
				const rings = relation.members.flatMap((m) => {
					const member = graph.entity(m.ref);
					return member?.type === "way" ? [wayLocs(graph, member)] : [];
				});
				found.set(relation.id, {
					id: relation.id,
					rings,
					levels: featureLevels(tags),
				});
			}
		}
	}
	return [...found.values()];
}

/** Whether every point and the middle of every side of `line` lies on one of `rings`. */
function runsAlong(
	line: readonly Loc[],
	rings: readonly (readonly Loc[])[],
): boolean {
	if (rings.length === 0) return false;
	const on = (p: readonly number[]) =>
		rings.some((ring) => distanceToLine(p, ring) <= ON_OUTLINE);
	if (!line.every(on)) return false;
	for (let i = 1; i < line.length; i++) {
		if (!on(midpoint(line[i - 1] as Loc, line[i] as Loc))) return false;
	}
	return true;
}

/** Corners standing off a straight side by less than this (metres) are jitter. */
export const JITTER = 0.03;
/** Only corners next to a side shorter than this many times `JITTER` can be jitter. */
const JITTER_SIDE = 4;

/** Closed indoor ways whose corners are a drawn shape. */
const JITTER_SHAPES = new Set(["room", "area", "corridor", "level", "column"]);

/**
 * Corners of an indoor outline that stand off a straight side by less than 3 cm next to a
 * side of a few centimetres (osm-simple3d-editor's `jitterVertices`): the hand shook while
 * tracing, and 3D draws a ridge on a flat wall. Corners on a long straight side (a junction
 * with a neighbour) are left alone, and so are corners other ways, relations or tags need:
 * the fix removes the rest.
 */
function jitter(graph: Graph, entity: Entity): Issue[] {
	if (entity.type !== "way" || !isClosed(entity)) return [];
	const { indoor, area } = entity.tags;
	if (
		!JITTER_SHAPES.has(indoor ?? "") &&
		!(indoor === "wall" && area === "yes")
	)
		return [];
	const ids = entity.nodes.slice(0, -1);
	const nodes = ids.map((id) => graph.entity(id));
	if (nodes.some((n) => n?.type !== "node")) return []; // not all downloaded
	const origin = (nodes[0] as Node).loc;
	const points = (nodes as Node[]).map((n) => local(origin, n.loc));
	const droppable = ids.map((id) => isDroppable(graph, entity, id));
	const gone = jitterCorners(points, droppable);
	if (gone.length === 0) return [];
	const dropped = gone.map((i) => ids[i] as NodeId);
	return [
		issue(
			"jitter",
			entity,
			msg("issue_jitter", {
				count: dropped.length,
				tolerance: Math.round(JITTER * 100),
			}),
			{
				fix: { label: msg("fix_drop_jitter"), action: deleteEntities(dropped) },
			},
		),
	];
}

/** Whether only `way` uses node `id`: no tags, no other way, no relation. */
function isDroppable(graph: Graph, way: Way, id: NodeId): boolean {
	const node = graph.entity(id);
	return (
		node?.type === "node" &&
		!hasInterestingTags(node.tags) &&
		graph.parentWays(id).every((w) => w.id === way.id) &&
		graph.parentRelations(id).length === 0 &&
		way.nodes.slice(0, -1).filter((n) => n === id).length === 1
	);
}

type Point = readonly [number, number];

/**
 * The corners of a ring (`points` in metres, without the closing point) that are jitter: each
 * can go, with every original point between its kept neighbours staying within `JITTER` of the
 * side between them. Greedy, smallest deviation first; at least three corners stay.
 */
export function jitterCorners(
	points: readonly Point[],
	droppable: readonly boolean[],
	tolerance = JITTER,
): number[] {
	const n = points.length;
	if (n <= 3) return [];
	const at = (i: number) => points[((i % n) + n) % n] as Point;
	const side = (i: number) => {
		const [ax, ay] = at(i);
		const [bx, by] = at(i + 1);
		return Math.hypot(bx - ax, by - ay);
	};
	const candidates = new Set(
		points
			.map((_, i) => i)
			.filter(
				(i) =>
					droppable[i] &&
					Math.min(side(i), side(i - 1)) < JITTER_SIDE * tolerance,
			),
	);
	if (candidates.size === 0) return [];
	const keep = points.map((_, i) => i);
	const deviation = (j: number) => {
		const a = keep[(j - 1 + keep.length) % keep.length] as number;
		const b = keep[(j + 1) % keep.length] as number;
		let worst = 0;
		for (let x = (a + 1) % n; x !== b; x = (x + 1) % n) {
			worst = Math.max(worst, offSegment(at(x), at(a), at(b)));
		}
		return worst;
	};
	while (keep.length > 3) {
		let best = -1;
		let bestDeviation = tolerance;
		for (let j = 0; j < keep.length; j++) {
			if (!candidates.has(keep[j] as number)) continue;
			const d = deviation(j);
			if (d < bestDeviation) {
				bestDeviation = d;
				best = j;
			}
		}
		if (best < 0) break;
		keep.splice(best, 1);
	}
	const kept = new Set(keep);
	return points.map((_, i) => i).filter((i) => !kept.has(i));
}

function offSegment(p: Point, a: Point, b: Point): number {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const l2 = dx * dx + dy * dy;
	const t = l2
		? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
		: 0;
	return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** A door this close (metres) to a side was meant to be in it, as `almost-joined`'s corners. */
const DOOR_ON_SIDE = 0.2;

/**
 * A door or entrance lying on a side of a room, corridor, area, level outline or building
 * outline on its level, without being one of that outline's nodes (osm-simple3d-editor
 * `fe416c4`): routing and 3D see a wall with no opening. The fix puts it in that side, as
 * `almost-joined` does for corners. A building's outline is on the ground floor only, and only
 * entrances and doors on no way are checked against it.
 */
function doorOnSide(graph: Graph, entity: Entity, outlines: Outlines): Issue[] {
	if (entity.type !== "node") return [];
	const { tags } = entity;
	const isDoor =
		tags.door !== undefined ||
		tags.indoor === "door" ||
		(tags.entrance !== undefined && tags.entrance !== "no");
	if (!isDoor) return [];
	const levels =
		featureLevels(tags) ??
		unionOfLevels(
			graph.parentWays(entity.id).map((w) => featureLevels(w.tags)),
		);
	// An indoor door on a room by the outer wall isn't meant to be in the building's outline.
	const outer =
		(tags.entrance !== undefined && tags.entrance !== "no") ||
		graph.parentWays(entity.id).length === 0;
	const target = outlines
		.near(entity.loc, DOOR_ON_SIDE)
		.filter((o) => !o.part && (outer || !o.building))
		.filter((o) => overlap(levels, levelsOf(o)))
		.map((o) => graph.entity(o.id))
		.find((w): w is Way => w?.type === "way" && !w.nodes.includes(entity.id));
	if (!target) return [];
	const fix = joinFix(graph, entity, target);
	return [
		issue("door-on-side", entity, msg("issue_door_on_side"), {
			key: target.id,
			...(fix && { fix }),
		}),
	];
}

/** The levels an outline is on: a building's is the ground floor, as drawn. */
function levelsOf(outline: Outline): Levels | null {
	if (outline.levels) return outline.levels;
	if (outline.building) return parseLevels("0");
	return null;
}
