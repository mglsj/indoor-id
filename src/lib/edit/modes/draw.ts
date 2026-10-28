/**
 * Drawing modes (P5.3.4). `drawWayMode`: clicks add corners to a line or an area
 * (`WayDrawing`), the pointer drags the last side along, Enter or a click on the last corner
 * (or an area's first) finishes, Backspace takes the last corner back, Escape finishes when
 * there are enough corners and stops otherwise. `drawPointMode`: one click places a point
 * whose role comes from where it snaps (`placePoint`). Both show what they draw through
 * `EditHistory.preview`, end in one undo step, and hand the new feature to `onfinish`.
 */
import { type Message, msg } from "#lib/i18n/messages.ts";
import type { Segment } from "#lib/map/feature-store.ts";
import type { SnapTarget } from "#lib/map/snap.ts";
import type { EntityId, NodeId } from "#lib/osm/entity.ts";
import type { Action } from "#lib/osm/history.ts";
import { type DrawKind, WayDrawing } from "../draw-way.ts";
import type { MapPoint, Mode } from "../mode.ts";
import type { DragHistory } from "../node-drag.ts";
import { placePoint } from "../place-point.ts";

/** Snaps a pointer position, leaving out the nodes `exclude` and the sides `keepSide` refuses. */
export type DrawSnap = (
	at: MapPoint,
	exclude: ReadonlySet<NodeId>,
	keepSide?: (side: Segment) => boolean,
) => SnapTarget | null;

export interface DrawOptions {
	readonly history: DragHistory & {
		perform(action: Action, annotation: Message): void;
	};
	readonly level: number;
	readonly snap: DrawSnap;
	/** Drawing ended: the feature made, or null when nothing was. */
	readonly onfinish: (id: EntityId | null) => void;
}

const ANNOTATIONS = {
	line: msg("undo_add_line"),
	area: msg("undo_add_area"),
};

export function drawWayMode(
	kind: DrawKind,
	{ history, level, snap, onfinish }: DrawOptions,
): Mode {
	const drawing = new WayDrawing(history.graph, kind, level);
	let ended = false;
	const cursor = new Set([drawing.cursorId]);
	/** The drawing's own sides can't be snapped onto (only its corners, to finish). */
	const keepSide = (side: Segment) =>
		!(drawing.has(side.a.id) && drawing.has(side.b.id)) &&
		side.a.id !== drawing.cursorId &&
		side.b.id !== drawing.cursorId;
	const snapped = (at: MapPoint) => snap(at, cursor, keepSide);
	const finish = () => {
		if (ended) return;
		ended = true;
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
			history.preview(drawing.action(target?.loc ?? at.lngLat));
			return "crosshair";
		},
		leave: () => history.preview(drawing.action()),
		click(at) {
			const target = snapped(at);
			const result = drawing.click(
				history.graph,
				target?.loc ?? at.lngLat,
				target,
			);
			if (result === "finish") finish();
			else history.preview(drawing.action(target?.loc ?? at.lngLat));
		},
		key(event) {
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
		exit() {
			// Left for another mode (the toolbar, floor plan mode): nothing is kept.
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
	};
}
