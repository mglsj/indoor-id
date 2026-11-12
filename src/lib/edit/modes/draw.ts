/**
 * Drawing modes (P5.3.4). `drawWayMode`: clicks add corners to a line or an area
 * (`WayDrawing`), the pointer drags the last side along, Enter or a click on the last corner
 * (or an area's first) finishes, Backspace takes the last corner back, Escape finishes when
 * there are enough corners and stops otherwise; Mod+Z takes the last corner back too (and stops
 * once none is left), as the history's undo waits until the drawing ends. `drawPointMode`: one click places a point
 * whose role comes from where it snaps (`placePoint`). Both show what they draw through
 * `EditHistory.preview`, end in one undo step, and hand the new feature to `onfinish`.
 */

import { angleLines } from "#lib/edit/precision/angles.ts";
import {
	type ShowFeedback,
	sideMeasure,
} from "#lib/edit/precision/feedback.ts";
import { bearingOf, type Frame } from "#lib/edit/precision/frame.ts";
import type { DirectionLine, SnapTarget } from "#lib/edit/precision/snap.ts";
import { type Message, msg } from "#lib/i18n/messages.ts";
import type { Segment } from "#lib/map/feature-store.ts";
import type { EntityId, Loc, NodeId } from "#lib/osm/entity.ts";
import type { Action } from "#lib/osm/history.ts";
import { type DrawKind, WayDrawing } from "../draw-way.ts";
import { isMac, matches } from "../keys.ts";
import type { MapPoint, Mode } from "../mode.ts";
import type { DragHistory } from "../node-drag.ts";
import { placePoint } from "../place-point.ts";

/** Direction constraints for a snap: lines to snap to, or one locked direction. */
export interface SnapConstraints {
	readonly lines?: readonly DirectionLine[];
	readonly lock?: DirectionLine;
}

/**
 * Snaps a pointer position, leaving out the nodes `exclude` and the sides `keepSide` refuses,
 * with direction constraints from the drawing.
 */
export type DrawSnap = (
	at: MapPoint,
	exclude: ReadonlySet<NodeId>,
	keepSide?: (side: Segment) => boolean,
	constraints?: SnapConstraints,
) => SnapTarget | null;

/** Precise drawing (C.1): the frame angles are measured in, the angle step, the feedback. */
export interface DrawPrecision {
	/** The drawing frame at a position (its building's, or north). */
	frameAt(loc: Loc): Frame;
	/** Degrees between snapped directions, or null without angle snapping (read each move). */
	step(): number | null;
	show: ShowFeedback;
}

export interface DrawOptions {
	readonly history: DragHistory & {
		perform(action: Action, annotation: Message): void;
	};
	readonly level: number;
	readonly snap: DrawSnap;
	/** Drawing ended: the feature made, or null when nothing was. */
	readonly onfinish: (id: EntityId | null) => void;
	readonly precision?: DrawPrecision;
}

const ANNOTATIONS = {
	line: msg("undo_add_line"),
	area: msg("undo_add_area"),
};

export function drawWayMode(
	kind: DrawKind,
	{ history, level, snap, onfinish, precision }: DrawOptions,
): Mode {
	const drawing = new WayDrawing(history.graph, kind, level);
	let ended = false;
	const cursor = new Set([drawing.cursorId]);
	/** The drawing's own sides can't be snapped onto (only its corners, to finish). */
	const keepSide = (side: Segment) =>
		!(drawing.has(side.a.id) && drawing.has(side.b.id)) &&
		side.a.id !== drawing.cursorId &&
		side.b.id !== drawing.cursorId;
	/** The frame, from the first corner on. */
	let frame: Frame | null = null;
	/** The direction Shift locked, while it is held. */
	let lock: DirectionLine | null = null;
	/** Where the pointer snaps, under the drawing's direction constraints. */
	const snapped = (at: MapPoint): SnapTarget | null => {
		const corners = drawing.locs(history.graph);
		const last = corners.at(-1);
		if (!precision || !frame || !last || at.altKey) {
			lock = null;
			return snap(at, cursor, keepSide);
		}
		const step = precision.step();
		const lines = step
			? angleLines({
					from: last,
					previous: corners.at(-2),
					firstSide:
						corners.length >= 3
							? [corners[0] as Loc, corners[1] as Loc]
							: undefined,
					frame,
					step,
				})
			: [];
		if (!at.shiftKey) lock = null;
		else if (!lock) {
			// Shift pressed: lock the direction the side has now.
			const free = snap(at, cursor, keepSide, { lines });
			const to = free?.loc ?? at.lngLat;
			if (to[0] !== last[0] || to[1] !== last[1])
				lock = { origin: last, angle: bearingOf(last, to) };
		}
		return snap(at, cursor, keepSide, lock ? { lock } : { lines });
	};
	/** Shows what the pointer snapped to, and the side being drawn. */
	const feedback = (target: SnapTarget | null, loc: Loc) => {
		if (!precision) return;
		const corners = drawing.locs(history.graph);
		const last = corners.at(-1);
		precision.show({
			snap: target,
			measures:
				last && frame && (loc[0] !== last[0] || loc[1] !== last[1])
					? [sideMeasure(last, loc, frame, corners.at(-2))]
					: [],
		});
	};
	const mac = isMac();
	const finish = () => {
		if (ended) return;
		ended = true;
		precision?.show(null);
		if (drawing.canFinish) {
			history.commit(drawing.action(), ANNOTATIONS[kind]);
			onfinish(drawing.wayId);
		} else {
			history.cancelPreview();
			onfinish(null);
		}
	};
	return {
		name: `draw-${kind}`,
		gestures: { doubleClickZoom: false },
		hover(at) {
			const target = snapped(at);
			const loc = target?.loc ?? at.lngLat;
			history.preview(drawing.action(loc));
			feedback(target, loc);
			return "crosshair";
		},
		leave() {
			history.preview(drawing.action());
			precision?.show(null);
		},
		click(at) {
			const target = snapped(at);
			const loc = target?.loc ?? at.lngLat;
			const result = drawing.click(history.graph, loc, target);
			if (result === "added") {
				frame ??= precision?.frameAt(loc) ?? null;
				lock = null;
			}
			if (result === "finish") finish();
			else {
				history.preview(drawing.action(loc));
				feedback(target, loc);
			}
		},
		key(event) {
			if (matches(event, "Mod+Z", mac)) {
				if (drawing.undoLast()) history.preview(drawing.action());
				else finish();
				return true;
			}
			// Redo waits for the drawing to end, as undo does.
			if (matches(event, "Mod+Shift+Z", mac) || matches(event, "Mod+Y", mac))
				return true;
			switch (event.key) {
				case "Enter":
				case "Escape":
					finish();
					return true;
				case "Backspace":
				case "Delete":
					drawing.undoLast();
					history.preview(drawing.action());
					return true;
				default:
					return false;
			}
		},
		finish,
		exit() {
			// Left for another mode (the toolbar, floor plan mode): nothing is kept.
			precision?.show(null);
			if (!ended) {
				ended = true;
				history.cancelPreview();
			}
		},
	};
}

export function drawPointMode({
	history,
	level,
	snap,
	onfinish,
}: DrawOptions): Mode {
	const none = new Set<NodeId>();
	return {
		name: "draw-point",
		hover: () => "crosshair",
		click(at) {
			const target = snap(at, none);
			const placed = placePoint(history.graph, at.lngLat, target, level);
			if (!placed) {
				// A tagged node: select it rather than stack another point on it.
				onfinish(target?.kind === "node" ? target.id : null);
				return;
			}
			history.perform(placed.action, placed.annotation);
			onfinish(placed.id);
		},
		key(event) {
			if (event.key !== "Escape") return false;
			onfinish(null);
			return true;
		},
		finish: () => onfinish(null),
	};
}
