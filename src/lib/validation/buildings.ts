/**
 * Building checks for map mode (B), from the 2026-11-24 recheck (W3): buildings whose outlines
 * overlap, a building inside another, and a shared wall drawn twice without being glued. They
 * follow osm-simple3d-editor's `findOverlaps` (ISC, `0c7f032`, `3a65872`; forum t/148767
 * #192–194), on building outlines drawn as ways.
 */
import { changeTags } from "#lib/actions/change-tags.ts";
import { msg } from "#lib/i18n/messages.ts";
import { clipPolygons } from "#lib/osm/clip.ts";
import type { Entity, Loc, Node, NodeId, Way } from "#lib/osm/entity.ts";
import { distanceToLine, extentsIntersect, local } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";
import type { Tags } from "#lib/osm/tags.ts";
import type { Outline, Outlines } from "./outlines.ts";
import { joinFix } from "./spatial.ts";
import type { Issue, IssueRule } from "./validate.ts";

/** Overlaps smaller than this (m²) are a loosely drawn shared wall, not an overlap. */
export const OVERLAP_AREA = 2;
/** …and so are overlaps thinner than this on average (metres: 2 × area / perimeter). */
export const OVERLAP_THICKNESS = 0.6;
/** A building with this share of its area in a larger one lies inside it. */
const INSIDE = 0.9;
/** A corner this close (metres) to another building's wall belongs on it. */
export const GLUE_GAP = 0.15;
/** Closer than this (metres), a corner is on the other's corner already. */
const SAME_SPOT = 0.01;
/** Degrees around an extent where a neighbour may still need gluing (about 1 m). */
const MARGIN = 1e-5;

export function buildingIssues(
	graph: Graph,
	entity: Entity,
	outlines: Outlines,
): Issue[] {
	if (entity.type !== "way") return [];
	const self = outlines.get(entity.id);
	if (!self?.building || !isChecked(entity.tags)) return [];
	const origin = self.ring[0];
	if (!origin) return [];
	const toLocal = (ring: readonly Loc[]) =>
		ring.map((loc) => local(origin, loc));
	const mine = [toLocal(self.ring)];
	const mineArea = ringArea(toLocal(self.ring));
	const { west, south, east, north } = self.extent;
	const issues: Issue[] = [];
	for (const other of outlines.within({
		west: west - MARGIN,
		south: south - MARGIN,
		east: east + MARGIN,
		north: north + MARGIN,
	})) {
		if (other.id === self.id || !other.building) continue;
		const way = graph.entity(other.id);
		if (way?.type !== "way" || !isChecked(way.tags)) continue;
		if ((entity.tags.layer ?? "0") !== (way.tags.layer ?? "0")) continue;
		// Neighbours that only come near can't overlap: no clipping for them.
		if (!extentsIntersect(self.extent, other.extent)) {
			issues.push(...unglued(graph, entity, way, other));
			continue;
		}
		const theirs = [toLocal(other.ring)];
		// Metres to the millimetre.
		const common = clipPolygons("intersection", [mine], [theirs], 1000);
		const area = common.reduce(
			(sum, polygon) =>
				sum +
				polygon.reduce(
					(s, ring, i) => s + (i === 0 ? 1 : -1) * ringArea(ring),
					0,
				),
			0,
		);
		const perimeter = common
			.flat()
			.reduce((sum, ring) => sum + ringLength(ring), 0);
		const thick = perimeter > 0 && (2 * area) / perimeter >= OVERLAP_THICKNESS;
		if (area < OVERLAP_AREA || !thick) {
			issues.push(...unglued(graph, entity, way, other));
			continue;
		}
		const theirArea = ringArea(toLocal(other.ring));
		// The other one lies in this one: it says so itself.
		if (area >= INSIDE * theirArea && theirArea <= mineArea) continue;
		if (area >= INSIDE * mineArea && mineArea < theirArea) {
			issues.push(
				issue("building-inside", entity, msg("issue_building_inside"), {
					key: other.id,
					fix: {
						label: msg("fix_make_building_part"),
						action: toBuildingPart(entity),
					},
				}),
			);
			continue;
		}
		issues.push(
			issue(
				"building-overlap",
				entity,
				msg("issue_building_overlap", { area: Math.round(area) }),
				{ key: other.id },
			),
		);
	}
	return issues;
}

/**
 * Buildings that may overlap others on purpose are left out: roofs, buildings under
 * construction, underground ones and ones raised off the ground (a building over a passage).
 */
function isChecked(tags: Tags): boolean {
	const { building } = tags;
	if (building === "roof" || building === "construction") return false;
	if (tags.location === "underground" || Number(tags.layer) < 0) return false;
	return !(
		Number(tags.min_height) > 0 || Number(tags["building:min_level"]) > 0
	);
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

/** `building=*` made `building:part=*`, keeping its value. */
function toBuildingPart(way: Way): Action {
	const { building, ...rest } = way.tags;
	return changeTags(way.id, { ...rest, "building:part": building ?? "yes" });
}

/**
 * The corners of `way` within `GLUE_GAP` of `other`'s wall without being on one of its
 * corners: one issue per neighbour, whose fix joins them all to that wall.
 */
function unglued(
	graph: Graph,
	way: Way,
	other: Way,
	outline: Outline,
): Issue[] {
	const theirs = new Set(other.nodes);
	const loose: NodeId[] = [];
	for (const id of new Set(way.nodes)) {
		if (theirs.has(id)) continue;
		const node = graph.entity(id);
		if (node?.type !== "node") continue;
		if (distanceToLine(node.loc, outline.ring) > GLUE_GAP) continue;
		const onCorner = outline.ring.some(
			(loc) => distanceToLine(node.loc, [loc]) < SAME_SPOT,
		);
		if (!onCorner) loose.push(id);
	}
	if (loose.length === 0) return [];
	const action: Action = (graph) =>
		loose.reduce((g, id) => {
			const node = g.entity(id);
			const wall = g.entity(other.id);
			if (node?.type !== "node" || wall?.type !== "way") return g;
			return joinFix(g, node as Node, wall)?.action(g) ?? g;
		}, graph);
	return [
		issue("unglued-wall", way, msg("issue_unglued_wall"), {
			key: other.id,
			fix: { label: msg("fix_join"), action },
		}),
	];
}

function ringArea(ring: readonly (readonly number[])[]): number {
	let twice = 0;
	for (let i = 1; i < ring.length; i++) {
		const [ax = 0, ay = 0] = ring[i - 1] ?? [];
		const [bx = 0, by = 0] = ring[i] ?? [];
		twice += ax * by - bx * ay;
	}
	return Math.abs(twice) / 2;
}

function ringLength(ring: readonly (readonly number[])[]): number {
	let length = 0;
	for (let i = 1; i < ring.length; i++) {
		const [ax = 0, ay = 0] = ring[i - 1] ?? [];
		const [bx = 0, by = 0] = ring[i] ?? [];
		length += Math.hypot(bx - ax, by - ay);
	}
	return length;
}
