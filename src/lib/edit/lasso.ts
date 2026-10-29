/**
 * Lasso selection (P5.3.6), after iD's Shift+drag lasso: the features drawn entirely inside
 * the lasso are selected, points and tagged vertices (doors) as well as ways (rooms, walls),
 * so that a room and what is in it can be selected at once. Untagged vertices are left out:
 * they are the ways' corners. Worked out in Web Mercator, as drawn.
 */
import type { EntityId, Loc, NodeId } from "#lib/osm/entity.ts";
import { pointInRing, toMercator } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import { hasInterestingTags } from "#lib/osm/tags.ts";
import type { Drag } from "./mode.ts";

/**
 * The features inside `lasso` ([lon, lat] positions, closed or not), from the drawn nodes
 * `nodes` (on the shown level) and the ways using them, in the order found.
 */
export function featuresInLasso(
	graph: Graph,
	lasso: readonly Loc[],
	nodes: readonly { id: NodeId; loc: Loc }[],
): EntityId[] {
	if (lasso.length < 3) return [];
	const ring = lasso.map((p) => toMercator(p));
	const inside = (loc: Loc) => pointInRing(toMercator(loc), ring);
	const found: EntityId[] = [];
	const insideNodes = new Set<NodeId>();
	for (const { id, loc } of nodes) {
		if (!inside(loc)) continue;
		insideNodes.add(id);
		const node = graph.entity(id);
		if (!node) continue;
		const isVertex = graph.parentWays(id).length > 0;
		if (!isVertex || hasInterestingTags(node.tags)) found.push(id);
	}
	const seen = new Set<EntityId>();
	for (const id of insideNodes) {
		for (const way of graph.parentWays(id)) {
			if (seen.has(way.id)) continue;
			seen.add(way.id);
			if (
				way.nodes.every((n) => insideNodes.has(n) || isInside(graph, n, inside))
			)
				found.push(way.id);
		}
	}
	return found;
}

/** A node not drawn on this level (an outline's), tested by its own position. */
function isInside(
	graph: Graph,
	id: NodeId,
	inside: (loc: Loc) => boolean,
): boolean {
	const node = graph.entity(id);
	return node?.type === "node" && inside(node.loc);
}

/** A lasso drawn by dragging from `start`: `onchange` shows it, `onend` gets it on release. */
export function lassoDrag(
	start: Loc,
	{
		onchange,
		onend,
	}: {
		onchange: (lasso: readonly Loc[]) => void;
		onend: (lasso: readonly Loc[]) => void;
	},
): Drag {
	const points: Loc[] = [start];
	return {
		cursor: "crosshair",
		move(at) {
			points.push(at.lngLat);
			onchange([...points, start]);
		},
		end() {
			onchange([]);
			onend(points);
		},
		cancel: () => onchange([]),
	};
}
