/**
 * The measure and guide tool (C.5, `M`), a tape as in SketchUp. "Measure": two snapped clicks
 * give the distance and the angle against the frame, shown until the next measure. "Guide"
 * (Tab, or the switch shown under the toolbar while the tool is on):
 * places a construction guide. A first click on a side starts a guide parallel to it, placed
 * by a click at the distance wanted or by typing that distance ("the corridor wall is 2.4 m
 * from this one"); a first click on anything else starts a guide through that point, placed by
 * a second point or by typing its angle against the frame. Escape takes back what was typed,
 * then the first click, then leaves the tool.
 */

import { angleLines } from "#lib/edit/precision/angles.ts";
import {
	guideEnds,
	offsetFrom,
	parallelAt,
} from "#lib/edit/precision/construction.ts";
import {
	type Feedback,
	type Measure,
	sideMeasure,
} from "#lib/edit/precision/feedback.ts";
import { bearingOf, type Frame, lengthOf } from "#lib/edit/precision/frame.ts";
import type {
	DirectionLine,
	Guide,
	SnapTarget,
} from "#lib/edit/precision/snap.ts";
import {
	EMPTY_INPUT,
	isTyping,
	parseAngle,
	parseTyped,
	type TypedInput,
	typeKey,
} from "#lib/edit/precision/typed.ts";
import type { Segment } from "#lib/map/feature-store.ts";
import type { Loc, NodeId } from "#lib/osm/entity.ts";
import type { MapPoint, Mode } from "../mode.ts";
import type { DrawPrecision, DrawSnap } from "./draw.ts";

export type MeasureVariant = "measure" | "guide";

export interface MeasureOptions {
	readonly snap: DrawSnap;
	readonly precision: DrawPrecision;
	readonly variant: MeasureVariant;
	/** Tab switched between measuring and placing guides. */
	readonly onvariant: (variant: MeasureVariant) => void;
	/** A guide was placed. */
	readonly onguide: (line: DirectionLine) => void;
	/** Escape with nothing started: leave the tool. */
	readonly onexit: () => void;
}

/** How far a guide being placed is drawn either side of its origin, in metres. */
const PREVIEW_REACH = 500;

/** Where a measure or a guide starts: a point, or a side for a parallel guide. */
interface Start {
	readonly loc: Loc;
	readonly side?: Segment;
}

const NONE = new Set<NodeId>();

/** The measure tool, which the toolbar's Measure / Guide switch also changes. */
export interface MeasureMode extends Mode {
	setVariant(variant: MeasureVariant): void;
}

export function measureMode({
	snap,
	precision,
	variant: initial,
	onvariant,
	onguide,
	onexit,
}: MeasureOptions): MeasureMode {
	let variant = initial;
	let start: Start | null = null;
	/** The last measure, shown until the next one starts. */
	let result: { from: Loc; to: Loc } | null = null;
	let typed: TypedInput = EMPTY_INPUT;
	let pointer: MapPoint | null = null;
	let frame: Frame | null = null;

	const snapped = (at: MapPoint): SnapTarget | null => {
		if (!start || start.side || at.altKey) return snap(at, NONE);
		const step = precision.step();
		const lines =
			step && frame ? angleLines({ from: start.loc, frame, step }) : [];
		return snap(at, NONE, undefined, { lines, from: start.loc });
	};

	/** The guide the pointer (`to`) or what was typed places now, or null. */
	const guideFor = (to: Loc): DirectionLine | null => {
		if (!start || !frame) return null;
		if (start.side) {
			const { a, b } = start.side;
			const value = isTyping(typed)
				? parseTyped(typed.length, precision.units())
				: null;
			if (isTyping(typed) && value?.kind !== "length") return null;
			const offset =
				value?.kind === "length" ? value.metres : offsetFrom(a.loc, b.loc, to);
			return parallelAt(a.loc, b.loc, offset, to);
		}
		if (isTyping(typed)) {
			const angle = parseAngle(typed.length);
			return angle === null
				? null
				: { origin: start.loc, angle: frame.angle + angle };
		}
		if (lengthOf(start.loc, to) === 0) return null;
		return { origin: start.loc, angle: bearingOf(start.loc, to) };
	};

	const show = (target: SnapTarget | null, to: Loc) => {
		const lines: Guide[] = [];
		const measures: Measure[] = [];
		if (variant === "measure") {
			const shown = start ? { from: start.loc, to } : result;
			if (shown && frame && lengthOf(shown.from, shown.to) > 0) {
				lines.push(shown);
				const m = sideMeasure(shown.from, shown.to, frame);
				measures.push(
					start
						? m
						: {
								...m,
								at: midpoint(shown.from, shown.to),
								pointer: false,
							},
				);
			}
		} else if (start && frame) {
			const guide = guideFor(to);
			if (guide) {
				const [a, b] = guideEnds(guide, PREVIEW_REACH);
				lines.push({ from: a, to: b });
			}
			if (start.side) {
				const { a, b } = start.side;
				measures.push({
					at: to,
					pointer: true,
					length: offsetFrom(a.loc, b.loc, to),
				});
			} else if (guide) {
				measures.push({
					...sideMeasure(start.loc, to, frame),
					angle: (((guide.angle - frame.angle) % 180) + 180) % 180,
				});
			}
		}
		const feedback: Feedback = {
			snap: target,
			measures,
			lines,
			input: isTyping(typed) ? typed : undefined,
		};
		precision.show(feedback);
	};

	const update = (at: MapPoint | null) => {
		if (!at) return;
		const target = snapped(at);
		show(target, target?.loc ?? at.lngLat);
	};

	const reset = () => {
		start = null;
		typed = EMPTY_INPUT;
	};

	const switchTo = (next: MeasureVariant) => {
		if (next === variant) return;
		variant = next;
		reset();
		result = null;
		onvariant(variant);
		update(pointer);
	};

	const place = (guide: DirectionLine | null) => {
		if (!guide) return;
		onguide(guide);
		reset();
	};

	return {
		name: `measure-${variant}`,
		gestures: { doubleClickZoom: false },
		hover(at) {
			pointer = at;
			update(at);
			return "crosshair";
		},
		leave() {
			pointer = null;
			precision.show(null);
		},
		click(at) {
			const target = snapped(at);
			const loc = target?.loc ?? at.lngLat;
			if (!start) {
				frame = precision.frameAt(loc);
				result = null;
				typed = EMPTY_INPUT;
				const side =
					variant === "guide" &&
					target?.kind === "segment" &&
					(!target.mark || target.mark === "midpoint")
						? target.segment
						: undefined;
				start = side ? { loc, side } : { loc };
			} else if (variant === "measure") {
				result = { from: start.loc, to: loc };
				reset();
			} else {
				typed = EMPTY_INPUT;
				place(guideFor(loc));
			}
			show(target, loc);
		},
		key(event) {
			if (event.key === "Tab" && !isTyping(typed)) {
				switchTo(variant === "measure" ? "guide" : "measure");
				return true;
			}
			if (start && variant === "guide") {
				const next = typeKey(typed, event, false);
				if (next) {
					typed = next;
					update(pointer);
					return true;
				}
				if (event.key === "Enter" && isTyping(typed)) {
					const target = pointer ? snapped(pointer) : null;
					place(guideFor(target?.loc ?? pointer?.lngLat ?? start.loc));
					update(pointer);
					return true;
				}
			}
			if (event.key !== "Escape") return false;
			if (isTyping(typed)) typed = EMPTY_INPUT;
			else if (start) start = null;
			else if (result) result = null;
			else {
				precision.show(null);
				onexit();
				return true;
			}
			update(pointer);
			if (!pointer) precision.show(null);
			return true;
		},
		finish() {
			reset();
			result = null;
			precision.show(null);
		},
		exit() {
			precision.show(null);
		},
		setVariant: switchTo,
	};
}

function midpoint(a: Loc, b: Loc): Loc {
	return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
