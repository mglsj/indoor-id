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
import type { ShowFeedback } from "#lib/edit/precision/feedback.ts";
import { lengthOf } from "#lib/edit/precision/frame.ts";
import type { SnapTarget } from "#lib/edit/precision/snap.ts";
import { type Message, msg } from "#lib/i18n/messages.ts";
import { featureLevels, unionOfLevels } from "#lib/levels/feature-levels.ts";
import { formatLevels } from "#lib/levels/levels.ts";
import type { EntityId, Loc, NodeId, WayId } from "#lib/osm/entity.ts";
import { midpoint } from "#lib/osm/geometry.ts";
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
	/** Shows what the node snaps to and the lengths of the sides next to it (C.1). */
	readonly show?: ShowFeedback;
}

export function nodeDrag(
	grab: NodeGrab,
	{ history, snap, onhint, show }: NodeDragOptions,
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
	const done = () => {
		onhint?.(null);
		show?.(null);
	};
	if (grab.kind === "vertex") onhint?.(movesHint(start, id));
	const neighbours = neighbourLocs(start, grab);
	return {
		cursor: "move",
		move(at) {
			const { loc, snapped } = target(at);
			history.preview(placed(loc));
			show?.({
				snap: snapped,
				measures: neighbours.map((n) => ({
					at: midpoint(n, loc),
					length: lengthOf(n, loc),
				})),
			});
		},
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

/** Where the corners next to the dragged node are: the ends of the sides that stretch. */
function neighbourLocs(graph: Graph, grab: NodeGrab): Loc[] {
	const ids = new Set<NodeId>();
	if (grab.kind === "midpoint") {
		ids.add(grab.a);
		ids.add(grab.b);
	} else {
		for (const way of graph.parentWays(grab.id)) {
			way.nodes.forEach((n, i) => {
				if (n !== grab.id) return;
				const closed =
					way.nodes.length > 1 && way.nodes[0] === way.nodes.at(-1);
				const last = way.nodes.length - 1;
				const before =
					i > 0 ? way.nodes[i - 1] : closed ? way.nodes[last - 1] : undefined;
				const after =
					i < last ? way.nodes[i + 1] : closed ? way.nodes[1] : undefined;
				for (const m of [before, after]) if (m && m !== grab.id) ids.add(m);
			});
		}
	}
	return [...ids].flatMap((n) => {
		const node = graph.entity(n);
		return node?.type === "node" ? [node.loc] : [];
	});
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
	const features = featuresUsing(graph, [id]);
	if (features.size < 2) return null;
	const levels = unionOfLevels([...features.values()]);
	return levels
		? msg("drag_moves_features", {
				count: features.size,
				levels: formatLevels(levels),
			})
		: msg("drag_moves_features_no_level", { count: features.size });
}

/**
 * The features drawn with these nodes, by id, with their levels: tagged nodes, the ways using
 * them, and the multipolygons those ways are in (an untagged member is drawn as its
 * multipolygon, so it isn't a feature of its own).
 */
export function featuresUsing(
	graph: Graph,
	nodes: Iterable<NodeId>,
): Map<EntityId, ReturnType<typeof featureLevels>> {
	const features = new Map<EntityId, ReturnType<typeof featureLevels>>();
	for (const id of nodes) {
		const node = graph.entity(id);
		if (node?.type !== "node") continue;
		if (hasInterestingTags(node.tags))
			features.set(id, featureLevels(node.tags));
		for (const way of graph.parentWays(id)) {
			if (features.has(way.id)) continue;
			const relations = graph.parentRelations(way.id);
			for (const relation of relations) {
				features.set(relation.id, featureLevels(relation.tags));
			}
			if (hasInterestingTags(way.tags) || relations.length === 0) {
				features.set(
					way.id,
					featureLevels(way.tags, () => relations.map((r) => r.tags)),
				);
			}
		}
	}
	return features;
}
