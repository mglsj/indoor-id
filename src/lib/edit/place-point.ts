/**
 * The point tool (P5.3.4): what a click makes depends on where it snaps, as in
 * osm-simple3d-editor's point tool. On a side of a room, corridor, area, wall or level outline
 * it makes a door (`indoor=door` + `door=yes`) in every way with that side; on a building's
 * outline, an entrance (`entrance=yes` + `door=yes`, on the shown level) in the building's
 * ways and the indoor ways sharing that side; on an untagged corner of those ways, that corner
 * becomes the door or entrance. Anywhere else it makes a point on the shown level, whose type
 * the user picks next.
 */

import { changeTags } from "#lib/actions/change-tags.ts";
import { addNode, insertNodeInSegment } from "#lib/actions/geometry.ts";
import { type Message, msg } from "#lib/i18n/messages.ts";
import type { SnapTarget } from "#lib/map/snap.ts";
import type { Loc, NodeId, Way } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";
import { hasInterestingTags, type Tags } from "#lib/osm/tags.ts";

export interface PlacedPoint {
	/** The node made or tagged (a fresh id from the graph for a new one). */
	readonly id: NodeId;
	readonly action: Action;
	readonly annotation: Message;
	/** What was made: the user picks a POI's type next. */
	readonly kind: "door" | "entrance" | "point";
}

type Role = "door" | "entrance" | null;

/** The role of a point on these ways: an entrance on a building, a door on an indoor way. */
function roleOn(ways: readonly Way[]): Role {
	if (
		ways.some((w) => w.tags.building !== undefined && w.tags.building !== "no")
	)
		return "entrance";
	if (ways.some((w) => w.tags.indoor !== undefined)) return "door";
	return null;
}

function roleTags(role: Role, level: number): Tags {
	switch (role) {
		case "door":
			// A door takes its walls' level (W's missing-level leaves vertices to their ways).
			return { indoor: "door", door: "yes" };
		case "entrance":
			return { entrance: "yes", door: "yes", level: String(level) };
		default:
			return { level: String(level) };
	}
}

const ANNOTATIONS = {
	door: msg("undo_add_door"),
	entrance: msg("undo_add_entrance"),
	point: msg("undo_add_point"),
};

/**
 * What a click at `loc`, snapped to `snapped`, places on `level`; null when it lands on a node
 * already tagged (the tool selects that node instead).
 */
export function placePoint(
	graph: Graph,
	loc: Loc,
	snapped: SnapTarget | null,
	level: number,
): PlacedPoint | null {
	if (snapped?.kind === "node") {
		const node = graph.entity(snapped.id);
		if (node?.type !== "node" || hasInterestingTags(node.tags)) return null;
		const role = roleOn(graph.parentWays(node.id));
		const kind = role ?? "point";
		return {
			id: node.id,
			action: changeTags(node.id, { ...node.tags, ...roleTags(role, level) }),
			annotation: ANNOTATIONS[kind],
			kind,
		};
	}
	const id = graph.newId("node");
	if (snapped?.kind === "segment") {
		const { a, b } = snapped.segment;
		const ways = graph
			.parentWays(a.id)
			.filter((w) => followEachOther(w.nodes, a.id, b.id));
		const role = roleOn(ways);
		const kind = role ?? "point";
		return {
			id,
			action: (g) =>
				insertNodeInSegment(
					id,
					a.id,
					b.id,
				)(addNode(id, snapped.loc, roleTags(role, level))(g)),
			annotation: ANNOTATIONS[kind],
			kind,
		};
	}
	return {
		id,
		action: addNode(id, snapped?.loc ?? loc, roleTags(null, level)),
		annotation: ANNOTATIONS.point,
		kind: "point",
	};
}

/** Whether `a` and `b` follow each other in `nodes`, either way round. */
function followEachOther(
	nodes: readonly NodeId[],
	a: NodeId,
	b: NodeId,
): boolean {
	for (let i = 1; i < nodes.length; i++) {
		const [x, y] = [nodes[i - 1], nodes[i]];
		if ((x === a && y === b) || (x === b && y === a)) return true;
	}
	return false;
}
