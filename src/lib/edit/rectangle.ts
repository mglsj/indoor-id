/**
 * The rectangle tool (C.2): two opposite corners along the drawing frame's axes, or a side
 * (two clicks, any direction) and a width (a third click), or a typed `width;depth`. The
 * first corner joins what it snapped to, as any drawn corner; the others are new nodes. The
 * result is an area, as the area tool draws one.
 */
import { addNode } from "#lib/actions/geometry.ts";
import type { Loc, NodeId, WayId } from "#lib/osm/entity.ts";
import { fromLocal, local } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";
import type { Tags } from "#lib/osm/tags.ts";
import { type Frame, fromFrame, toFrame } from "./precision/frame.ts";

/** Below this a side is no side (OSM keeps about a centimetre). */
const MIN_SIDE = 0.01;

type Corners = [Loc, Loc, Loc, Loc];

/** The rectangle along the frame's axes with opposite corners `a` and `b`, from `a` around. */
export function frameRectangle(frame: Frame, a: Loc, b: Loc): Corners | null {
	const turned: Frame = { origin: a, angle: frame.angle };
	const [x, y] = toFrame(turned, b);
	if (Math.abs(x) < MIN_SIDE || Math.abs(y) < MIN_SIDE) return null;
	return sized(turned, x, y);
}

/**
 * The rectangle `width` × `depth` from `a` along the frame's axes, towards `toward` (the
 * pointer says which quarter).
 */
export function typedRectangle(
	frame: Frame,
	a: Loc,
	width: number,
	depth: number,
	toward: Loc,
): Corners | null {
	const turned: Frame = { origin: a, angle: frame.angle };
	const [tx, ty] = toFrame(turned, toward);
	const x = Math.abs(width) * (tx < 0 ? -1 : 1);
	const y = Math.abs(depth) * (ty < 0 ? -1 : 1);
	if (Math.abs(x) < MIN_SIDE || Math.abs(y) < MIN_SIDE) return null;
	return sized(turned, x, y);
}

function sized(frame: Frame, x: number, y: number): Corners {
	return [
		frame.origin,
		fromFrame(frame, [x, 0]),
		fromFrame(frame, [x, y]),
		fromFrame(frame, [0, y]),
	];
}

/**
 * The rectangle on the side `a`–`b`, as wide as `c` is from that side's line (or `width`
 * metres when typed, on `c`'s side).
 */
export function sideRectangle(
	a: Loc,
	b: Loc,
	c: Loc,
	width?: number,
): Corners | null {
	const [bx, by] = local(a, b);
	const length = Math.hypot(bx, by);
	if (length < MIN_SIDE) return null;
	const [nx, ny] = [-by / length, bx / length];
	const [cx, cy] = local(a, c);
	const offset = cx * nx + cy * ny;
	const w =
		width === undefined ? offset : Math.abs(width) * (offset < 0 ? -1 : 1);
	if (Math.abs(w) < MIN_SIDE) return null;
	return [
		a,
		b,
		fromLocal(a, [bx + nx * w, by + ny * w]),
		fromLocal(a, [nx * w, ny * w]),
	];
}

/**
 * The rectangle as an action, after `first` (which adds the first corner, `firstId`): three
 * new nodes `ids` at `corners[1..3]` and a closed way `wayId` tagged `tags`.
 */
export function rectangleAction(
	first: Action,
	firstId: NodeId,
	ids: readonly [NodeId, NodeId, NodeId],
	corners: Corners,
	wayId: WayId,
	tags: Tags,
): Action {
	return (graph: Graph) => {
		let g = first(graph);
		ids.forEach((id, i) => {
			g = addNode(id, corners[i + 1] as Loc)(g);
		});
		return g.replace({
			type: "way",
			id: wayId,
			nodes: [firstId, ...ids, firstId],
			tags,
		});
	};
}
