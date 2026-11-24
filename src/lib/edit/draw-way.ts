/**
 * Drawing a line or an area (P5.3.4), click by click: each click adds a corner, onto the node
 * it snaps to (shared with the ways there), onto a side (a new node in every way with that
 * side), or a new node. The way is tagged with the shown level (`area=yes` too for an area,
 * so the user picks its type next, as iD). `action` builds the whole drawing at once, with
 * the pointer as a last corner while it moves, for `EditHistory.preview`; the end commits it
 * as one undo step. With tracing on (P6), a click on a node after a corner on a node also puts
 * in the nodes between them along the existing ways (`trace`).
 */
import { addNode, insertNodeInSegment } from "#lib/actions/geometry.ts";
import type { SnapTarget } from "#lib/edit/precision/snap.ts";
import type { Loc, NodeId, WayId } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";
import type { Tags } from "#lib/osm/tags.ts";

export type DrawKind = "line" | "area";

type Corner =
	| {
			readonly kind: "node";
			readonly id: NodeId;
			/** Put in by tracing (P6): taken back with the corner clicked after it. */
			readonly traced?: true;
	  }
	| {
			readonly kind: "new";
			readonly id: NodeId;
			readonly loc: Loc;
			/** The side it was put on, whose ways get it too. */
			readonly side?: { readonly a: NodeId; readonly b: NodeId };
	  };

/** The existing nodes between two along the ways (`tracePath`), or null. */
export type Trace = (from: NodeId, to: NodeId) => readonly NodeId[] | null;

/** What a click did. */
export type ClickResult = "added" | "finish" | "ignored";

export class WayDrawing {
	readonly kind: DrawKind;
	readonly wayId: WayId;
	/** The node following the pointer in previews. */
	readonly cursorId: NodeId;
	readonly #tags: Tags;
	#corners: Corner[] = [];

	constructor(graph: Graph, kind: DrawKind, level: number) {
		this.kind = kind;
		this.wayId = graph.newId("way");
		this.cursorId = graph.newId("node");
		this.#tags =
			kind === "area"
				? { area: "yes", level: String(level) }
				: { level: String(level) };
	}

	/** The corners' node ids, in order. */
	get nodes(): NodeId[] {
		return this.#corners.map((c) => c.id);
	}

	/** The corners' positions, in order (an existing node's from `graph`). */
	locs(graph: Graph): Loc[] {
		return this.#corners.flatMap((c) => {
			if (c.kind === "new") return [c.loc];
			const node = graph.entity(c.id);
			return node?.type === "node" ? [node.loc] : [];
		});
	}

	/** Enough corners for the way: two for a line, three for an area. */
	get canFinish(): boolean {
		return this.#corners.length >= (this.kind === "area" ? 3 : 2);
	}

	/**
	 * A click at `loc`, snapped to `snapped`. On the last corner (or the first of an area) it
	 * finishes once there are enough corners; on another corner of the drawing it does nothing.
	 * New nodes get their ids from `graph` (the graph shown).
	 */
	click(
		graph: Graph,
		loc: Loc,
		snapped: SnapTarget | null,
		trace?: Trace,
	): ClickResult {
		if (snapped?.kind === "node") {
			const index = this.nodes.indexOf(snapped.id);
			const last = index === this.#corners.length - 1;
			const first = index === 0 && this.kind === "area";
			if (index >= 0) {
				if (!(last || first) || !this.canFinish) return "ignored";
				if (first) this.#trace(snapped.id, trace);
				return "finish";
			}
			this.#trace(snapped.id, trace);
			this.#corners.push({ kind: "node", id: snapped.id });
			return "added";
		}
		const id = graph.newId("node");
		this.#corners.push(
			snapped?.kind === "segment"
				? {
						kind: "new",
						id,
						loc: snapped.loc,
						side: { a: snapped.segment.a.id, b: snapped.segment.b.id },
					}
				: { kind: "new", id, loc: snapped?.loc ?? loc },
		);
		return "added";
	}

	/**
	 * With tracing on, the nodes between the last corner and `to` along the ways joining them,
	 * as corners: only from an existing node to an existing node, never through the drawing's.
	 */
	#trace(to: NodeId, trace: Trace | undefined): void {
		const last = this.#corners.at(-1);
		if (!trace || last?.kind !== "node") return;
		const path = trace(last.id, to);
		if (!path || path.some((id) => this.has(id))) return;
		for (const id of path)
			this.#corners.push({ kind: "node", id, traced: true });
	}

	/** Takes the last corner back, with the corners traced before it; false when there was none. */
	undoLast(): boolean {
		if (this.#corners.pop() === undefined) return false;
		while (this.#corners.at(-1)?.kind === "node") {
			const corner = this.#corners.at(-1) as { traced?: true };
			if (!corner.traced) break;
			this.#corners.pop();
		}
		return true;
	}

	/** Whether a node is one of the drawing's corners. */
	has(id: NodeId): boolean {
		return this.nodes.includes(id);
	}

	/**
	 * The drawing as an action: its new nodes, and its way once it has two nodes (closed from
	 * three for an area). `cursor`: the pointer, a last corner while drawing.
	 */
	action(cursor?: Loc): Action {
		const corners = [...this.#corners];
		const tags = this.#tags;
		const wayId = this.wayId;
		const cursorId = this.cursorId;
		const area = this.kind === "area";
		return (graph: Graph) => {
			let g = graph;
			for (const corner of corners) {
				if (corner.kind !== "new") continue;
				g = addNode(corner.id, corner.loc)(g);
				if (corner.side) {
					g = insertNodeInSegment(corner.id, corner.side.a, corner.side.b)(g);
				}
			}
			const nodes = corners.map((c) => c.id);
			if (cursor) {
				g = addNode(cursorId, cursor)(g);
				nodes.push(cursorId);
			}
			if (nodes.length < 2) return g;
			const first = nodes[0] as NodeId;
			const way = area && nodes.length >= 3 ? [...nodes, first] : nodes;
			return g.replace({ type: "way", id: wayId, nodes: way, tags });
		};
	}
}
