/**
 * Dragging selected features whole (P5.3.3's leftover, iD's move): a press on a selected
 * point, way or multipolygon moves everything selected with the pointer, each node by the
 * same distance on the map (in Web Mercator, so shapes keep their angles). Nodes shared with
 * features not selected move too, so those stretch along, as in iD; the drag says so, with
 * their levels (`othersHint`), since they may be on levels not shown (a room above sharing the
 * building's corners). Shown live with `history.preview`, one undo step on release.
 */
import { type Message, msg } from "#lib/i18n/messages.ts";
import { unionOfLevels } from "#lib/levels/feature-levels.ts";
import { formatLevels } from "#lib/levels/levels.ts";
import type { EntityId, Loc, NodeId } from "#lib/osm/entity.ts";
import { fromMercator, toMercator } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";
import type { Drag, MapPoint } from "./mode.ts";
import { type DragHistory, featuresUsing } from "./node-drag.ts";

/** The nodes moving `ids` moves: points, ways' nodes, multipolygons' ways' nodes. */
export function nodesOf(graph: Graph, ids: readonly EntityId[]): Set<NodeId> {
	const nodes = new Set<NodeId>();
	const add = (id: EntityId, depth: number) => {
		const entity = graph.entity(id);
		if (entity?.type === "node") nodes.add(entity.id);
		else if (entity?.type === "way") for (const n of entity.nodes) nodes.add(n);
		// A relation's ways, not relations in it (a site holds whole buildings).
		else if (entity?.type === "relation" && depth === 0) {
			for (const m of entity.members) {
				if (m.ref[0] === "w") add(m.ref, 1);
			}
		}
	};
	for (const id of ids) add(id, 0);
	return nodes;
}

/** Moves `nodes` by the map distance from `from` to `to`, from where they are in `start`. */
export function moveBy(
	start: Graph,
	nodes: ReadonlySet<NodeId>,
	from: Loc,
	to: Loc,
): Action {
	const [fx, fy] = toMercator(from);
	const [tx, ty] = toMercator(to);
	// History runs an action on one copy (`Graph.update`): replacing node by node is cheap.
	return (graph) => {
		let moved = graph;
		for (const id of nodes) {
			const node = start.entity(id);
			if (node?.type !== "node") continue;
			const [x, y] = toMercator(node.loc);
			moved = moved.replace({
				...node,
				loc: fromMercator([x + tx - fx, y + ty - fy]),
			});
		}
		return moved;
	};
}

/**
 * What moving `ids` moves besides them, through shared nodes: "also moves 2 features not
 * selected, on levels 1;2", or null when nothing else moves. Members of a selected
 * multipolygon move with it and don't count.
 */
export function othersHint(
	graph: Graph,
	ids: readonly EntityId[],
): Message | null {
	const selected = new Set<EntityId>(ids);
	for (const id of ids) {
		const entity = graph.entity(id);
		if (entity?.type === "relation") {
			for (const m of entity.members) selected.add(m.ref);
		}
	}
	const others = [...featuresUsing(graph, nodesOf(graph, ids))].filter(
		([id]) => !selected.has(id),
	);
	if (others.length === 0) return null;
	const levels = unionOfLevels(others.map(([, l]) => l));
	return levels
		? msg("drag_moves_others", {
				count: others.length,
				levels: formatLevels(levels),
			})
		: msg("drag_moves_others_no_level", { count: others.length });
}

export interface FeatureDragOptions {
	/** What the drag moves besides the selection (`othersHint`), or null when done. */
	readonly onhint?: (hint: Message | null) => void;
}

export function featureDrag(
	ids: readonly EntityId[],
	from: MapPoint,
	history: DragHistory,
	{ onhint }: FeatureDragOptions = {},
): Drag {
	const start = history.graph;
	const nodes = nodesOf(start, ids);
	const move = (at: MapPoint) => moveBy(start, nodes, from.lngLat, at.lngLat);
	onhint?.(othersHint(start, ids));
	return {
		cursor: "move",
		move: (at) => history.preview(move(at)),
		end: (at) => {
			history.commit(
				move(at),
				ids.length > 1 ? msg("undo_move_features") : msg("undo_move_feature"),
			);
			onhint?.(null);
		},
		cancel: () => {
			history.cancelPreview();
			onhint?.(null);
		},
	};
}
