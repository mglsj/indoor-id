/**
 * Dragging a node (P5.3.3): a vertex moves every way using it, a point moves alone, a midpoint
 * becomes a new vertex of every way sharing its side. The map shows each move live
 * (`EditHistory.preview`) and the release makes one undo step. The pointer snaps onto nodes
 * and sides on the shown level; dropped on a node it joins it (as iD's connect), dropped on a
 * side it becomes a vertex of that side's ways, so walls and rooms share their nodes.
 */
import { connectNodes, connectRefusal } from "#lib/actions/connect.ts";
import {
	addVertex,
	insertNodeInSegment,
	moveNode,
} from "#lib/actions/geometry.ts";
import { type Message, msg } from "#lib/i18n/messages.ts";
import { featureLevels, unionOfLevels } from "#lib/levels/feature-levels.ts";
import { formatLevels } from "#lib/levels/levels.ts";
import type { SnapTarget } from "#lib/map/snap.ts";
import type { Loc, NodeId, WayId } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";
import { hasInterestingTags } from "#lib/osm/tags.ts";
import type { Drag, MapPoint } from "./mode.ts";

/** What is dragged: an existing node, or a side's midpoint. */
export type NodeGrab =
	| { readonly kind: "vertex"; readonly id: NodeId }
	| {
			readonly kind: "midpoint";
			readonly way: WayId;
			readonly a: NodeId;
			readonly b: NodeId;
	  };

/** The part of `EditHistory` a drag uses. */
export interface DragHistory {
	readonly graph: Graph;
	preview(action: Action): void;
	commit(action: Action, annotation: Message): void;
	cancelPreview(): void;
}

export interface NodeDragOptions {
	readonly history: DragHistory;
	/** What a pointer position snaps to, leaving out the nodes `exclude` and their sides. */
	readonly snap: (
		at: MapPoint,
		exclude: ReadonlySet<NodeId>,
	) => SnapTarget | null;
	/** What the drag moves besides the node (shared vertices), or null when done. */
	readonly onhint?: (hint: Message | null) => void;
}

export function nodeDrag(
	grab: NodeGrab,
	{ history, snap, onhint }: NodeDragOptions,
): Drag {
	const start = history.graph;
	const id = grab.kind === "vertex" ? grab.id : start.newId("node");
	const exclude = new Set([id]);
	const placed = (loc: Loc): Action =>
		grab.kind === "vertex"
			? moveNode(id, loc)
			: addVertex(id, loc, grab.a, grab.b);
	/** Where the pointer puts the node, and what it would join there. */
	const target = (at: MapPoint) => {
		const snapped = snap(at, exclude);
		return { loc: snapped?.loc ?? at.lngLat, snapped };
	};
	const done = () => onhint?.(null);
	if (grab.kind === "vertex") onhint?.(movesHint(start, id));
	return {
		cursor: "move",
		move: (at) => history.preview(placed(target(at).loc)),
		end(at) {
			const { loc, snapped } = target(at);
			const move = placed(loc);
			const moved = start.update(move);
			const join = joinAction(moved, id, snapped);
			history.commit(
				join ? (g) => join(move(g)) : move,
				join
					? msg("undo_connect")
					: grab.kind === "vertex"
						? msg("undo_move_node")
						: msg("undo_add_vertex"),
			);
			done();
		},
		cancel() {
			history.cancelPreview();
			done();
		},
	};
}

/** Joining the node dropped on `snapped`: into a node, or into a side's ways. */
function joinAction(
	graph: Graph,
	id: NodeId,
	snapped: SnapTarget | null,
): Action | null {
	if (snapped?.kind === "node") {
		return connectRefusal(graph, id, snapped.id) === null
			? connectNodes(id, snapped.id)
			: null;
	}
	if (snapped?.kind === "segment") {
		const { a, b } = snapped.segment;
		// A way already through the node would cross itself.
		const ownSide = graph
			.parentWays(id)
			.some((w) => w.nodes.includes(a.id) && w.nodes.includes(b.id));
		return ownSide ? null : insertNodeInSegment(id, a.id, b.id);
	}
	return null;
}

/**
 * What moving the node `id` moves with it, when that is more than one feature: "moves 3
 * features on levels 0;1" (rooms sharing the building outline's nodes, on every level).
 */
export function movesHint(graph: Graph, id: NodeId): Message | null {
	const node = graph.entity(id);
	if (node?.type !== "node") return null;
	const features = new Map<string, ReturnType<typeof featureLevels>>();
	if (hasInterestingTags(node.tags)) features.set(id, featureLevels(node.tags));
	for (const way of graph.parentWays(id)) {
		const relations = graph.parentRelations(way.id);
		for (const relation of relations) {
			features.set(relation.id, featureLevels(relation.tags));
		}
		// An untagged member is drawn as its multipolygon.
		if (hasInterestingTags(way.tags) || relations.length === 0) {
			features.set(
				way.id,
				featureLevels(way.tags, () => relations.map((r) => r.tags)),
			);
		}
	}
	if (features.size < 2) return null;
	const levels = unionOfLevels([...features.values()]);
	return levels
		? msg("drag_moves_features", {
				count: features.size,
				levels: formatLevels(levels),
			})
		: msg("drag_moves_features_no_level", { count: features.size });
}
