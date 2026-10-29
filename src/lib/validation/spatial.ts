/**
 * Spatial checks (P5.3.9): what depends on where features are and how they join, after iD's
 * validations (`crossing_ways`, `unsquare_way`, `close_nodes`, `almost_junction`,
 * `disconnected_way`) brought indoors, with levels compared as levels (`isOnLevel`), not as
 * strings. Each takes one entity and the outlines index (`Outlines`), as `validate` does.
 */
import { changeTags } from "#lib/actions/change-tags.ts";
import { connectNodes, connectRefusal } from "#lib/actions/connect.ts";
import { insertNodeInSegment, moveNode } from "#lib/actions/geometry.ts";
import { isUnsquare, orthogonalize } from "#lib/actions/orthogonalize.ts";
import { msg } from "#lib/i18n/messages.ts";
import { featureLevels } from "#lib/levels/feature-levels.ts";
import { formatLevels, type Levels } from "#lib/levels/levels.ts";
import type { Entity, Loc, Node, NodeId, Way } from "#lib/osm/entity.ts";
import {
	fromMercator,
	isClosed,
	isClosedRing,
	toMercator,
	wayLocs,
} from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { Tags } from "#lib/osm/tags.ts";
import type { Outline, Outlines } from "./outlines.ts";
import type { Issue, IssueRule } from "./validate.ts";

type Vec = [number, number];

/** Indoor spaces whose corners should join the sides along them. */
const SPACES = new Set(["room", "area", "corridor", "level"]);
/** Spaces that shouldn't overlap. */
const ROOMS = new Set(["room", "corridor"]);
/** A corner this close to a side (metres) was meant to be on it. */
const ALMOST_JOINED = 0.2;
/** Two nodes of a way this close (metres) are one drawn twice. */
const CLOSE_NODES = 0.05;
const PATHS = new Set(["footway", "corridor", "steps", "path", "pedestrian"]);

export function spatialIssues(
	graph: Graph,
	entity: Entity,
	outlines: Outlines,
): Issue[] {
	return [
		...emptyTags(entity),
		...levelOutsideBuilding(graph, entity, outlines),
		...noLevelOutline(graph, entity, outlines),
		...almostJoined(graph, entity, outlines),
		...crossingRooms(graph, entity, outlines),
		...unsquare(graph, entity),
		...closeNodes(graph, entity),
		...disconnectedPath(graph, entity),
	];
}

function issue(
	rule: IssueRule,
	entity: Entity,
	message: Issue["message"],
	{
		fix,
		key,
		severity = "warning",
	}: { fix?: Issue["fix"]; key?: string; severity?: Issue["severity"] } = {},
): Issue {
	return {
		id: `${rule}:${entity.id}${key ? `:${key}` : ""}`,
		rule,
		severity,
		entityId: entity.id,
		message,
		...(fix && { fix }),
	};
}

/** A key or a value that is empty or only spaces: OSM refuses it. */
function emptyTags(entity: Entity): Issue[] {
	const empty = Object.entries(entity.tags).filter(
		([k, v]) => k.trim() === "" || v.trim() === "",
	);
	if (empty.length === 0) return [];
	const kept: Record<string, string> = {};
	for (const [k, v] of Object.entries(entity.tags)) {
		if (k.trim() !== "" && v.trim() !== "") kept[k] = v;
	}
	return [
		issue("empty-tag", entity, msg("issue_empty_tag"), {
			severity: "error",
			fix: {
				label: msg("fix_remove_empty_tags"),
				action: changeTags(entity.id, kept),
			},
		}),
	];
}

/** The levels a feature names itself (not a vertex's ways', not a building's own). */
function ownLevels(graph: Graph, entity: Entity): Levels | null {
	if (entity.type === "relation") return null;
	if (entity.type === "node" && graph.parentWays(entity.id).length > 0)
		return null;
	if (entity.tags.building !== undefined) return null;
	return entity.tags.level !== undefined || entity.tags.repeat_on !== undefined
		? featureLevels(entity.tags)
		: null;
}

/** Where a feature is: a point's position, a way's middle (the mean of its corners). */
function centreOf(graph: Graph, entity: Node | Way): Loc | null {
	if (entity.type === "node") return entity.loc;
	const locs = wayLocs(graph, entity);
	const corners = isClosed(entity) ? locs.slice(0, -1) : locs;
	if (corners.length === 0) return null;
	return [0, 1].map(
		(i) =>
			corners.reduce((sum, loc) => sum + (loc[i] ?? 0), 0) / corners.length,
	) as unknown as Loc;
}

function overlap(a: Levels, b: Levels): boolean {
	return a.some((x) => b.some((y) => x.min <= y.max && y.min <= x.max));
}

/** A feature in a building on levels the building says it doesn't have (`building:levels`). */
function levelOutsideBuilding(
	graph: Graph,
	entity: Entity,
	outlines: Outlines,
): Issue[] {
	const levels = ownLevels(graph, entity);
	if (!levels || entity.type === "relation") return [];
	const centre = centreOf(graph, entity);
	if (!centre) return [];
	const building = outlines
		.at(centre)
		.find((o) => o.building && o.buildingLevels && o.id !== entity.id);
	if (!building?.buildingLevels || overlap(levels, building.buildingLevels))
		return [];
	return [
		issue(
			"level-outside-building",
			entity,
			msg("issue_level_outside_building", {
				level: formatLevels(levels),
				levels: formatLevels(building.buildingLevels),
			}),
		),
	];
}

/**
 * A room, corridor or area on a level of a building that maps `indoor=level` outlines for its
 * other levels but not this one: the level outline was probably forgotten.
 */
function noLevelOutline(
	graph: Graph,
	entity: Entity,
	outlines: Outlines,
): Issue[] {
	if (entity.type !== "way" || !SPACES.has(entity.tags.indoor ?? "")) return [];
	if (entity.tags.indoor === "level") return [];
	const levels = ownLevels(graph, entity);
	const centre = centreOf(graph, entity);
	if (!levels || !centre) return [];
	const building = outlines.at(centre).find((o) => o.building);
	if (!building) return [];
	const outlinesInside = outlines
		.within(building.extent)
		.filter((o) => o.indoor === "level" && o.levels)
		.filter((o) => {
			const c = ringCentre(o.ring);
			return c !== null && outlines.at(c).some((b) => b.id === building.id);
		});
	if (outlinesInside.length === 0) return [];
	if (outlinesInside.some((o) => o.levels && overlap(o.levels, levels)))
		return [];
	return [
		issue(
			"no-level-outline",
			entity,
			msg("issue_no_level_outline", { level: formatLevels(levels) }),
		),
	];
}

function ringCentre(ring: readonly Loc[]): Loc | null {
	const corners = ring.slice(0, -1);
	if (corners.length === 0) return null;
	return [0, 1].map(
		(i) =>
			corners.reduce((sum, loc) => sum + (loc[i] ?? 0), 0) / corners.length,
	) as unknown as Loc;
}

/** The levels a way is on, or null for every level (a building's outline). */
function outlineLevels(outline: Outline): Levels | null {
	return outline.levels;
}

/**
 * A corner of a room, corridor, area or wall within 20 cm of a side of another indoor space or
 * a building's outline, on the same level, without being one of its nodes (iD's
 * `almost_junction`): routing and 3D see a gap. The fix puts the corner on that side (or
 * merges it with that side's corner, when one is as close).
 */
function almostJoined(
	graph: Graph,
	entity: Entity,
	outlines: Outlines,
): Issue[] {
	if (entity.type !== "way") return [];
	const indoor = entity.tags.indoor ?? "";
	if (!SPACES.has(indoor) && indoor !== "wall") return [];
	const levels = featureLevels(entity.tags);
	const issues: Issue[] = [];
	for (const id of new Set(entity.nodes)) {
		const node = graph.entity(id);
		if (node?.type !== "node") continue;
		const target = outlines
			.near(node.loc, ALMOST_JOINED)
			.filter((o) => o.id !== entity.id)
			.filter((o) => {
				const other = outlineLevels(o);
				return !levels || !other || overlap(levels, other);
			})
			.map((o) => graph.entity(o.id))
			.find(
				(w): w is Way =>
					w?.type === "way" && !w.nodes.includes(id) && !sharesSide(entity, w),
			);
		if (!target) continue;
		const fix = joinFix(graph, node, target);
		issues.push(
			issue("almost-joined", entity, msg("issue_almost_joined"), {
				key: id,
				...(fix && { fix }),
			}),
		);
	}
	return issues;
}

/** Whether two ways already run along each other on a shared side (they are joined). */
function sharesSide(a: Way, b: Way): boolean {
	const nodes = new Set(b.nodes);
	return a.nodes.filter((n) => nodes.has(n)).length >= 2;
}

/** The fix joining `node` to the nearest side of `way`: onto its corner, or into the side. */
function joinFix(graph: Graph, node: Node, way: Way): Issue["fix"] | undefined {
	const point = toMercator(node.loc);
	let best: { a: NodeId; b: NodeId; at: Vec; d: number } | null = null;
	for (let i = 1; i < way.nodes.length; i++) {
		const a = graph.entity(way.nodes[i - 1] as NodeId);
		const b = graph.entity(way.nodes[i] as NodeId);
		if (a?.type !== "node" || b?.type !== "node") continue;
		const at = nearestOnSegment(point, toMercator(a.loc), toMercator(b.loc));
		const d = Math.hypot(at[0] - point[0], at[1] - point[1]);
		if (!best || d < best.d) best = { a: a.id, b: b.id, at, d };
	}
	if (!best) return undefined;
	const { a, b, at } = best;
	const corner = [a, b].find((c) => {
		const n = graph.entity(c);
		if (n?.type !== "node") return false;
		const [x, y] = toMercator(n.loc);
		return Math.hypot(x - at[0], y - at[1]) < 1e-6;
	});
	if (corner) {
		if (connectRefusal(graph, node.id, corner)) return undefined;
		return { label: msg("fix_join"), action: connectNodes(node.id, corner) };
	}
	const loc = fromMercator(at);
	return {
		label: msg("fix_join"),
		action: (g: Graph) =>
			insertNodeInSegment(node.id, a, b)(moveNode(node.id, loc)(g)),
	};
}

function nearestOnSegment(p: Vec, a: Vec, b: Vec): Vec {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const l2 = dx * dx + dy * dy;
	const t = l2
		? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
		: 0;
	return [a[0] + t * dx, a[1] + t * dy];
}

/** Rooms and corridors whose outlines cross on the same level (iD's `crossing_ways`). */
function crossingRooms(
	graph: Graph,
	entity: Entity,
	outlines: Outlines,
): Issue[] {
	if (entity.type !== "way" || !ROOMS.has(entity.tags.indoor ?? "")) return [];
	const self = outlines.get(entity.id);
	if (!self) return [];
	const issues: Issue[] = [];
	for (const other of outlines.within(self.extent)) {
		if (other.id === self.id || !ROOMS.has(other.indoor ?? "")) continue;
		if (self.levels && other.levels && !overlap(self.levels, other.levels))
			continue;
		const way = graph.entity(other.id);
		if (way?.type !== "way" || !crosses(graph, entity, way)) continue;
		issues.push(
			issue("crossing-rooms", entity, msg("issue_crossing_rooms"), {
				key: other.id,
			}),
		);
	}
	return issues;
}

/** Whether two ways' sides cross somewhere other than at a node they share. */
function crosses(graph: Graph, a: Way, b: Way): boolean {
	const points = (w: Way) =>
		w.nodes.map((n) => {
			const node = graph.entity(n);
			return node?.type === "node" ? toMercator(node.loc) : null;
		});
	const pa = points(a);
	const pb = points(b);
	for (let i = 1; i < a.nodes.length; i++) {
		for (let j = 1; j < b.nodes.length; j++) {
			const shared = [a.nodes[i - 1], a.nodes[i]].some(
				(n) => n === b.nodes[j - 1] || n === b.nodes[j],
			);
			if (shared) continue;
			const p = pa[i - 1];
			const q = pa[i];
			const r = pb[j - 1];
			const s = pb[j];
			if (p && q && r && s && properlyCross(p, q, r, s)) return true;
		}
	}
	return false;
}

function properlyCross(p: Vec, q: Vec, r: Vec, s: Vec): boolean {
	const d1: Vec = [q[0] - p[0], q[1] - p[1]];
	const d2: Vec = [s[0] - r[0], s[1] - r[1]];
	const denom = d1[0] * d2[1] - d1[1] * d2[0];
	if (Math.abs(denom) < 1e-12) return false;
	const e: Vec = [r[0] - p[0], r[1] - p[1]];
	const t = (e[0] * d2[1] - e[1] * d2[0]) / denom;
	const u = (e[0] * d1[1] - e[1] * d1[0]) / denom;
	const eps = 1e-9;
	return t > eps && t < 1 - eps && u > eps && u < 1 - eps;
}

/** A room, corridor or area a few degrees off square (iD's `unsquare_way`). */
function unsquare(graph: Graph, entity: Entity): Issue[] {
	if (entity.type !== "way" || !SPACES.has(entity.tags.indoor ?? "")) return [];
	if (entity.tags.indoor === "level" || !isClosedRing(entity)) return [];
	if (!isUnsquare(graph, entity.id)) return [];
	return [
		issue("unsquare-room", entity, msg("issue_unsquare_room"), {
			fix: { label: msg("fix_square"), action: orthogonalize(entity.id) },
		}),
	];
}

/** Two nodes of an indoor way, one after the other, within 5 cm (iD's `close_nodes`). */
function closeNodes(graph: Graph, entity: Entity): Issue[] {
	if (entity.type !== "way" || isIgnored(entity.tags)) return [];
	for (let i = 1; i < entity.nodes.length; i++) {
		const a = graph.entity(entity.nodes[i - 1] as NodeId);
		const b = graph.entity(entity.nodes[i] as NodeId);
		if (a?.type !== "node" || b?.type !== "node" || a.id === b.id) continue;
		const [ax, ay] = toMercator(a.loc);
		const [bx, by] = toMercator(b.loc);
		const scale = Math.cos((a.loc[1] * Math.PI) / 180);
		if (Math.hypot(bx - ax, by - ay) * scale >= CLOSE_NODES) continue;
		const refused = connectRefusal(graph, b.id, a.id);
		return [
			issue("close-nodes", entity, msg("issue_close_nodes"), {
				key: b.id,
				...(!refused && {
					fix: {
						label: msg("fix_merge_nodes"),
						action: connectNodes(b.id, a.id),
					},
				}),
			}),
		];
	}
	return [];
}

/** Only indoor ways are checked here; the rest is left to other editors' rules. */
function isIgnored(tags: Tags): boolean {
	return tags.indoor === undefined && tags.level === undefined;
}

/**
 * An indoor footway, corridor or flight of steps joined to no other path, door, entrance or
 * elevator (iD's `disconnected_way`): routing can't reach it.
 */
function disconnectedPath(graph: Graph, entity: Entity): Issue[] {
	if (entity.type !== "way" || !PATHS.has(entity.tags.highway ?? "")) return [];
	if (isIgnored(entity.tags) || isClosedRing(entity)) return [];
	const joined = entity.nodes.some((id) => {
		const node = graph.entity(id);
		if (node?.type !== "node") return true; // not downloaded: can't tell
		const { tags } = node;
		if (
			tags.door !== undefined ||
			tags.entrance !== undefined ||
			tags.highway === "elevator"
		)
			return true;
		return graph
			.parentWays(id)
			.some((w) => w.id !== entity.id && w.tags.highway !== undefined);
	});
	return joined
		? []
		: [issue("disconnected-path", entity, msg("issue_disconnected_path"))];
}
