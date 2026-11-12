/**
 * Precise edits of the selection by clicks or typed values (C.6), after osm-simple3d-editor's
 * move, rotate and scale tools and JOSM's extrude:
 *
 * - "move": click a base point, then where it goes, or type the distance towards the pointer.
 * - "rotate": click the centre, then a reference point, then where it turns to, or type the
 *   angle (counterclockwise).
 * - "scale": click the fixed point, then a reference point, then where it goes, or type the
 *   factor.
 * - "side": click a side of the selected way, then where it goes (its neighbours keep their
 *   directions), or type the distance towards the pointer.
 * - "offset": a parallel copy of the selected way through the pointer, or at a typed distance
 *   on the pointer's side.
 *
 * Points snap as when drawing, with angle lines from the first click. The edit is previewed
 * through `history.preview` and made in one undo step; Escape takes back what was typed, then
 * the last click, then leaves.
 */
import {
	moveSide,
	offsetWay,
	rotateNodes,
	scaleNodes,
	translateNodes,
} from "#lib/actions/transform.ts";
import { type Message, msg } from "#lib/i18n/messages.ts";
import type { Segment } from "#lib/map/feature-store.ts";
import type { EntityId, Loc, NodeId, WayId } from "#lib/osm/entity.ts";
import { fromLocal, local, pointInPolygon } from "#lib/osm/geometry.ts";
import type { Action } from "#lib/osm/history.ts";
import type { MapPoint, Mode } from "../mode.ts";
import type { DragHistory } from "../node-drag.ts";
import { angleLines } from "../precision/angles.ts";
import type { Measure } from "../precision/feedback.ts";
import {
	bearingOf,
	type Frame,
	lengthOf,
	normalizeAngle,
} from "../precision/frame.ts";
import type { SnapTarget } from "../precision/snap.ts";
import {
	EMPTY_INPUT,
	isTyping,
	parseAngle,
	parseTyped,
	type TypedInput,
	typeKey,
} from "../precision/typed.ts";
import type { DrawPrecision, DrawSnap } from "./draw.ts";

export type TransformTool = "move" | "rotate" | "scale" | "side" | "offset";

export interface TransformOptions {
	readonly tool: TransformTool;
	readonly history: DragHistory;
	/** The selection the tool edits. */
	readonly ids: readonly EntityId[];
	/** The nodes moved by move, rotate and scale (the selection's, shared ones included). */
	readonly nodes: ReadonlySet<NodeId>;
	readonly snap: DrawSnap;
	readonly precision: DrawPrecision;
	/** The tool ended: what to select (null: leave the selection as it is). */
	readonly onfinish: (select: readonly EntityId[] | null) => void;
}

const ANNOTATIONS: Record<TransformTool, Message> = {
	move: msg("undo_move_typed"),
	rotate: msg("undo_rotate"),
	scale: msg("undo_scale"),
	side: msg("undo_move_side"),
	offset: msg("undo_offset"),
};

/** How many clicks place the tool's reference points before the last one. */
const POINTS: Record<TransformTool, number> = {
	move: 1,
	rotate: 2,
	scale: 2,
	side: 1,
	offset: 0,
};

const NONE = new Set<NodeId>();

export function transformMode({
	tool,
	history,
	ids,
	nodes,
	snap,
	precision,
	onfinish,
}: TransformOptions): Mode {
	const way =
		ids.length === 1 && ids[0]?.startsWith("w") ? (ids[0] as WayId) : null;
	/** The points clicked so far. */
	let points: Loc[] = [];
	/** The side being moved (tool "side"). */
	let side: { index: number; a: Loc; b: Loc } | null = null;
	let typed: TypedInput = EMPTY_INPUT;
	let pointer: MapPoint | null = null;
	let frame: Frame | null = null;
	let ended = false;

	/** The selected way's ring, its closing node left out, as positions. */
	const ring = (): Loc[] => {
		const entity = way && history.graph.entity(way);
		if (entity?.type !== "way") return [];
		const locs = history.graph.childNodes(entity).map((n) => n.loc);
		return entity.nodes[0] === entity.nodes.at(-1) ? locs.slice(0, -1) : locs;
	};

	/** Move, rotate and scale don't snap to the nodes they move. */
	const exclude = tool === "side" || tool === "offset" ? NONE : nodes;
	const snapped = (at: MapPoint): SnapTarget | null => {
		const from = points[0];
		const step = precision.step();
		if (!from || !frame || !step || at.altKey) return snap(at, exclude);
		return snap(at, exclude, undefined, {
			lines: angleLines({ from, frame, step }),
		});
	};

	const typedLength = (): number | null => {
		const value = parseTyped(typed.length, precision.units());
		return value?.kind === "length" ? value.metres : null;
	};

	/** The edit the pointer (`to`) or what was typed makes now, and what to show. */
	const editFor = (
		to: Loc,
	): { action: Action; measure?: Measure; select?: EntityId[] } | null => {
		switch (tool) {
			case "move": {
				const [base] = points;
				if (!base) return null;
				let target = to;
				const typedMetres = isTyping(typed) ? typedLength() : null;
				if (isTyping(typed) && typedMetres === null) return null;
				if (typedMetres !== null) {
					const [x, y] = local(base, to);
					const length = Math.hypot(x, y);
					if (length === 0) return null;
					target = fromLocal(base, [
						(x / length) * typedMetres,
						(y / length) * typedMetres,
					]);
				}
				const offset = local(base, target);
				return {
					action: translateNodes(nodes, offset),
					measure: frame
						? {
								at: target,
								pointer: true,
								length: lengthOf(base, target),
								angle: angleIn(frame, bearingOf(base, target)),
							}
						: undefined,
				};
			}
			case "rotate": {
				const [centre, reference] = points;
				if (!centre || !reference) return null;
				let degrees = normalizeAngle(
					bearingOf(centre, to) - bearingOf(centre, reference),
				);
				if (isTyping(typed)) {
					const typedDegrees = parseAngle(typed.length);
					if (typedDegrees === null) return null;
					degrees = typedDegrees;
				}
				return {
					action: rotateNodes(nodes, centre, degrees),
					measure: {
						at: to,
						pointer: true,
						length: 0,
						angle: degrees,
						shows: "angle",
					},
				};
			}
			case "scale": {
				const [fixed, reference] = points;
				if (!fixed || !reference) return null;
				const [rx, ry] = local(fixed, reference);
				const r2 = rx * rx + ry * ry;
				if (r2 === 0) return null;
				const [px, py] = local(fixed, to);
				let factor = (px * rx + py * ry) / r2;
				if (isTyping(typed)) {
					const value = Number(typed.length.replace(",", "."));
					if (!Number.isFinite(value) || value <= 0) return null;
					factor = value;
				}
				if (factor === 0) return null;
				return {
					action: scaleNodes(nodes, fixed, factor),
					measure: {
						at: to,
						pointer: true,
						length: 0,
						factor,
						shows: "factor",
					},
				};
			}
			case "side": {
				if (!side || !way) return null;
				const signed = signedOffset(side.a, side.b, to);
				const typedMetres = isTyping(typed) ? typedLength() : null;
				if (isTyping(typed) && typedMetres === null) return null;
				const distance =
					typedMetres === null ? signed : Math.sign(signed || 1) * typedMetres;
				return {
					action: moveSide(way, side.index, distance),
					measure: { at: to, pointer: true, length: Math.abs(distance) },
				};
			}
			case "offset": {
				if (!way) return null;
				const corners = ring();
				const nearest = nearestSide(corners, to);
				if (!nearest) return null;
				const inside =
					corners.length > 2 &&
					pointInPolygon(to, [[...corners, corners[0] as Loc]]);
				const typedMetres = isTyping(typed) ? typedLength() : null;
				if (isTyping(typed) && typedMetres === null) return null;
				const metres = typedMetres ?? nearest.distance;
				const distance = inside ? metres : -metres;
				const make = offsetWay(way, distance);
				let made: EntityId | null = null;
				return {
					action: (graph) => {
						const result = make(graph);
						made = result.id;
						return result.graph;
					},
					measure: { at: to, pointer: true, length: metres },
					get select() {
						return made ? [made] : undefined;
					},
				};
			}
		}
	};

	const show = (target: SnapTarget | null, loc: Loc) => {
		const edit =
			points.length >= POINTS[tool] && (tool !== "side" || side)
				? editFor(loc)
				: null;
		if (edit) history.preview(edit.action);
		else history.cancelPreview();
		precision.show({
			snap: target,
			measures: edit?.measure ? [edit.measure] : [],
			lines: points[0]
				? [...points.slice(1), loc].map((to) => ({
						from: points[0] as Loc,
						to,
					}))
				: [],
			input: isTyping(typed) ? typed : undefined,
		});
		return edit;
	};

	const update = (at: MapPoint | null) => {
		if (!at) return null;
		const target = snapped(at);
		return show(target, target?.loc ?? at.lngLat);
	};

	const finish = (select: readonly EntityId[] | null) => {
		if (ended) return;
		ended = true;
		precision.show(null);
		onfinish(select);
	};

	const commit = (edit: { action: Action; select?: EntityId[] } | null) => {
		if (!edit) return;
		history.commit(edit.action, ANNOTATIONS[tool]);
		finish(edit.select ?? null);
	};

	const cancel = () => {
		history.cancelPreview();
		finish(null);
	};

	return {
		name: `transform-${tool}`,
		gestures: { doubleClickZoom: false },
		hover(at) {
			pointer = at;
			update(at);
			return "crosshair";
		},
		leave() {
			pointer = null;
		},
		click(at) {
			const target = snapped(at);
			const loc = target?.loc ?? at.lngLat;
			frame ??= precision.frameAt(loc);
			if (tool === "side" && !side) {
				const corners = ring();
				const index =
					target?.kind === "segment" && target.segment.way === way
						? sideIndex(corners, target.segment)
						: -1;
				if (index >= 0) {
					side = {
						index,
						a: corners[index] as Loc,
						b: corners[(index + 1) % corners.length] as Loc,
					};
					points = [loc];
				}
				return;
			}
			if (points.length < POINTS[tool]) {
				points = [...points, loc];
				typed = EMPTY_INPUT;
				show(target, loc);
				return;
			}
			commit(show(target, loc));
		},
		key(event) {
			const started =
				points.length >= POINTS[tool] && (tool !== "side" || side);
			if (started) {
				const next = typeKey(typed, event, false);
				if (next) {
					typed = next;
					update(pointer);
					return true;
				}
				if (event.key === "Enter" && isTyping(typed)) {
					commit(update(pointer));
					return true;
				}
			}
			if (event.key !== "Escape") return false;
			if (isTyping(typed)) typed = EMPTY_INPUT;
			else if (points.length > 0) {
				points = points.slice(0, -1);
				if (tool === "side") side = null;
			} else {
				cancel();
				return true;
			}
			history.cancelPreview();
			update(pointer);
			return true;
		},
		finish: cancel,
		exit() {
			if (!ended) {
				ended = true;
				history.cancelPreview();
				precision.show(null);
			}
		},
	};
}

/** An angle against the frame's x axis, 0 to 360. */
function angleIn(frame: Frame, bearing: number): number {
	return (((bearing - frame.angle) % 360) + 360) % 360;
}

/** How far `p` is to the left of the line a → b, in metres (negative: right). */
function signedOffset(a: Loc, b: Loc, p: Loc): number {
	const [ex, ey] = local(a, b);
	const [px, py] = local(a, p);
	const length = Math.hypot(ex, ey);
	return length === 0 ? 0 : (ex * py - ey * px) / length;
}

/** The index of a side in a ring of positions (its first end's), or -1. */
function sideIndex(ring: readonly Loc[], segment: Segment): number {
	const same = (p: Loc, q: Loc) => p[0] === q[0] && p[1] === q[1];
	for (let i = 0; i < ring.length; i++) {
		const a = ring[i] as Loc;
		const b = ring[(i + 1) % ring.length] as Loc;
		if (
			(same(a, segment.a.loc) && same(b, segment.b.loc)) ||
			(same(a, segment.b.loc) && same(b, segment.a.loc))
		)
			return i;
	}
	return -1;
}

/** The side of a ring nearest `p`, and how far it is, in metres. */
function nearestSide(
	ring: readonly Loc[],
	p: Loc,
): { distance: number } | null {
	let best: number | null = null;
	for (let i = 0; i < ring.length; i++) {
		const a = ring[i] as Loc;
		const b = ring[(i + 1) % ring.length] as Loc;
		const [ex, ey] = local(a, b);
		const [px, py] = local(a, p);
		const l2 = ex * ex + ey * ey;
		const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, (px * ex + py * ey) / l2));
		const d = Math.hypot(px - t * ex, py - t * ey);
		if (best === null || d < best) best = d;
	}
	return best === null ? null : { distance: best };
}
