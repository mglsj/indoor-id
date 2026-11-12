/**
 * The rectangle tool's mode (C.2, `4`): a first click places a corner (joining what it snaps
 * to); a second click places the opposite corner along the frame's axes, or, after Tab, the
 * other end of a side, and a third click the width. Typed values instead of the last click:
 * `width;depth` for two corners, a length for a side or a width. Shown through
 * `EditHistory.preview`, one undo step, the area handed to `onfinish` for its type.
 */
import { msg } from "#lib/i18n/messages.ts";
import type { Loc, NodeId } from "#lib/osm/entity.ts";
import type { Action } from "#lib/osm/history.ts";
import { WayDrawing } from "../draw-way.ts";
import { isMac, matches } from "../keys.ts";
import type { MapPoint, Mode } from "../mode.ts";
import { angleLines } from "../precision/angles.ts";
import { sideMeasure } from "../precision/feedback.ts";
import { type Frame, lengthOf } from "../precision/frame.ts";
import type { SnapTarget } from "../precision/snap.ts";
import {
	EMPTY_INPUT,
	isTyping,
	parseTyped,
	type TypedInput,
	typedCorner,
	typeKey,
} from "../precision/typed.ts";
import {
	frameRectangle,
	rectangleAction,
	sideRectangle,
	typedRectangle,
} from "../rectangle.ts";
import type { DrawOptions } from "./draw.ts";

export type RectangleVariant = "corners" | "side";

export interface RectangleOptions extends DrawOptions {
	/** The way of drawing it changed (Tab), for the hint. */
	readonly onvariant?: (variant: RectangleVariant) => void;
}

export function drawRectangleMode({
	history,
	level,
	snap,
	onfinish,
	precision,
	onvariant,
}: RectangleOptions): Mode {
	const drawing = new WayDrawing(history.graph, "area", level);
	const ids: [NodeId, NodeId, NodeId] = [
		history.graph.newId("node"),
		history.graph.newId("node"),
		history.graph.newId("node"),
	];
	const tags = { area: "yes", level: String(level) };
	const none = new Set<NodeId>([drawing.cursorId, ...ids]);
	let variant: RectangleVariant = "corners";
	let frame: Frame | null = null;
	/** The side's other end, in the side variant. */
	let sideEnd: Loc | null = null;
	let typed: TypedInput = EMPTY_INPUT;
	let pointer: MapPoint | null = null;
	let aim: Loc | null = null;
	let ended = false;

	const first = () => drawing.locs(history.graph)[0];
	const units = () => precision?.units() ?? "metric";

	/** Where the pointer snaps: points, and angles for a side's other end. */
	const snapped = (at: MapPoint): SnapTarget | null => {
		const a = first();
		const step = precision?.step();
		if (a && frame && variant === "side" && !sideEnd && step && !at.altKey) {
			return snap(at, none, undefined, {
				lines: angleLines({ from: a, frame, step }),
			});
		}
		return snap(at, none);
	};

	/** The rectangle as it stands, or the side so far, with what to show. */
	const shape = (): {
		action: Action;
		corners: Loc[] | null;
		measure?: { at: Loc; length: number; depth?: number; angle?: number };
	} => {
		const a = first();
		if (!a || !frame || !aim)
			return { action: drawing.action(), corners: null };
		const value = isTyping(typed) ? parseTyped(typed.length, units()) : null;
		if (variant === "side" && !sideEnd) {
			const b =
				value?.kind === "length"
					? typedCorner({ value, from: a, frame, toward: aim })
					: aim;
			return {
				action: drawing.action(b),
				corners: null,
				measure: sideMeasure(a, b, frame),
			};
		}
		let corners: [Loc, Loc, Loc, Loc] | null;
		if (variant === "side" && sideEnd) {
			corners = sideRectangle(
				a,
				sideEnd,
				aim,
				value?.kind === "length" ? value.metres : undefined,
			);
		} else if (value?.kind === "pair") {
			corners = typedRectangle(frame, a, value.x, value.y, aim);
		} else {
			corners = frameRectangle(frame, a, aim);
		}
		if (!corners) return { action: drawing.action(aim), corners: null };
		const [, b, c, d] = corners;
		return {
			action: rectangleAction(
				drawing.action(),
				drawing.nodes[0] as NodeId,
				ids,
				corners,
				drawing.wayId,
				tags,
			),
			corners,
			measure: { at: c, length: lengthOf(a, b), depth: lengthOf(a, d) },
		};
	};

	const update = (at: MapPoint | null) => {
		const target = at ? snapped(at) : null;
		aim = target?.loc ?? at?.lngLat ?? aim;
		const { action, measure } = shape();
		history.preview(action);
		precision?.show({
			snap: isTyping(typed) ? null : target,
			measures: measure ? [{ ...measure, pointer: true }] : [],
			input: isTyping(typed) ? typed : undefined,
		});
	};

	const end = (done: boolean) => {
		if (ended) return;
		ended = true;
		precision?.show(null);
		const { action, corners } = shape();
		if (done && corners) {
			history.commit(action, msg("undo_add_rectangle"));
			onfinish(drawing.wayId);
		} else {
			history.cancelPreview();
			onfinish(null);
		}
	};

	/** The next click, or Enter after typing: a corner, a side's end, or the rectangle. */
	const place = (loc: Loc, target: SnapTarget | null) => {
		if (!first()) {
			drawing.click(history.graph, loc, target);
			frame = precision?.frameAt(loc) ?? { origin: loc, angle: 0 };
			return;
		}
		if (variant === "side" && !sideEnd) {
			const a = first() as Loc;
			if (lengthOf(a, loc) < 0.01) return;
			sideEnd = loc;
			return;
		}
		end(true);
	};

	return {
		name: "draw-rectangle",
		gestures: { doubleClickZoom: false },
		hover(at) {
			pointer = at;
			update(at);
			return "crosshair";
		},
		leave() {
			precision?.show(null);
		},
		click(at) {
			const target = snapped(at);
			const loc = target?.loc ?? at.lngLat;
			aim = loc;
			typed = EMPTY_INPUT;
			place(loc, target);
			if (!ended) update(at);
		},
		key(event) {
			if (first() && frame) {
				const next = typeKey(typed, event, false);
				if (next) {
					typed = next;
					update(pointer);
					return true;
				}
				if (event.key === "Enter" && isTyping(typed)) {
					const a = first() as Loc;
					const value = parseTyped(typed.length, units());
					if (!value || !aim) return true;
					if (variant === "side" && !sideEnd) {
						if (value.kind !== "length") return true;
						sideEnd = typedCorner({ value, from: a, frame, toward: aim });
						typed = EMPTY_INPUT;
						update(pointer);
						return true;
					}
					if (shape().corners) end(true);
					return true;
				}
			}
			const undo = matches(event, "Mod+Z", isMac());
			switch (undo ? "Backspace" : event.key) {
				case "Tab":
					if (sideEnd || isTyping(typed)) return true;
					variant = variant === "corners" ? "side" : "corners";
					onvariant?.(variant);
					update(pointer);
					return true;
				case "Escape":
					if (isTyping(typed)) {
						typed = EMPTY_INPUT;
						update(pointer);
					} else end(false);
					return true;
				case "Enter":
					end(true);
					return true;
				case "Backspace":
				case "Delete":
					if (sideEnd) sideEnd = null;
					else if (first()) {
						drawing.undoLast();
						frame = null;
					}
					update(pointer);
					return true;
				default:
					return false;
			}
		},
		finish: () => end(false),
		exit() {
			precision?.show(null);
			if (!ended) {
				ended = true;
				history.cancelPreview();
			}
		},
	};
}
