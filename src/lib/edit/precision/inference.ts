/**
 * Inference (C.4): what CAD calls object snap tracking and SketchUp inference. Hovering a side
 * for a moment arms it: its extensions past its ends, and lines parallel and square to it
 * through the corner being drawn from, become direction lines to snap to. Hovering a corner
 * arms it too: lines along the frame's axes and along its own sides run through it, so a new
 * corner can sit in line with it. Armed things are forgotten a few seconds after they were
 * last used (after osm-simple3d-editor's extension snapping, ISC: 1 s to arm, 30 m, 4 s).
 *
 * Time comes from a clock passed in, so the tracker stays pure; a mode asks `nextChange()`
 * when to look again, since arming happens while the pointer stands still.
 */
import type { Loc, NodeId } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";
import { bearingOf, type Frame } from "./frame.ts";
import type { DirectionLine, SnapTarget } from "./snap.ts";

/** How long the pointer stays on a side before it is armed, in ms. */
export const ARM_SIDE_MS = 1000;
/** …and on a corner. */
export const ARM_CORNER_MS = 500;
/** How long an armed side or corner lasts after it was last used, in ms. */
export const FORGET_MS = 4000;
/** How far a side's extension reaches past its end, in metres. */
export const EXTENSION_METRES = 30;
/** At most this many sides, and this many corners, are armed at once. */
export const MAX_ARMED = 4;

/** What the pointer is on: a side, or a corner and the directions of its sides. */
export type Hovered =
	| {
			readonly kind: "side";
			readonly key: string;
			readonly a: Loc;
			readonly b: Loc;
	  }
	| {
			readonly kind: "corner";
			readonly key: string;
			readonly loc: Loc;
			readonly directions: readonly number[];
	  };

interface Armed {
	readonly item: Hovered;
	lastUse: number;
}

export class Inferences {
	readonly #clock: () => number;
	#pending: { item: Hovered; since: number } | null = null;
	#armed: Armed[] = [];

	constructor(clock: () => number = () => performance.now()) {
		this.#clock = clock;
	}

	/** The side or corner the pointer is on now (null: neither). */
	hover(item: Hovered | null): void {
		const now = this.#clock();
		this.#forget(now);
		if (!item) {
			this.#pending = null;
			return;
		}
		const armed = this.#armed.find((a) => a.item.key === item.key);
		if (armed) {
			armed.lastUse = now;
			this.#pending = null;
			return;
		}
		if (this.#pending?.item.key !== item.key) {
			this.#pending = { item, since: now };
			return;
		}
		if (now - this.#pending.since >= armTime(item)) {
			this.#arm(item, now);
			this.#pending = null;
		}
	}

	/** An inferred line was snapped to: everything armed lasts a while longer. */
	used(): void {
		const now = this.#clock();
		for (const armed of this.#armed) armed.lastUse = now;
	}

	/** Forgets everything armed. */
	clear(): void {
		this.#pending = null;
		this.#armed = [];
	}

	/** The corners armed now, to mark them on the map. */
	corners(): Loc[] {
		this.#forget(this.#clock());
		return this.#armed.flatMap(({ item }) =>
			item.kind === "corner" ? [item.loc] : [],
		);
	}

	/**
	 * The lines of what is armed: sides' extensions, and, from the corner `from` being drawn
	 * from, lines parallel and square to armed sides; lines in line with armed corners.
	 */
	lines({ from, frame }: { from?: Loc; frame: Frame }): DirectionLine[] {
		this.#forget(this.#clock());
		const lines: DirectionLine[] = [];
		for (const { item } of this.#armed) {
			if (item.kind === "side") {
				const { a, b } = item;
				const along = bearingOf(a, b);
				const extension = {
					ray: true,
					reach: EXTENSION_METRES,
					kind: "extension",
				} as const;
				lines.push({ origin: b, angle: along, ...extension });
				lines.push({ origin: a, angle: along + 180, ...extension });
				if (from && !same(from, a) && !same(from, b)) {
					lines.push({ origin: from, angle: fold(along), kind: "parallel" });
					lines.push({
						origin: from,
						angle: fold(along + 90),
						kind: "perpendicular",
					});
				}
			} else if (!from || !same(from, item.loc)) {
				const angles: number[] = [];
				for (const angle of [
					frame.angle,
					frame.angle + 90,
					...item.directions,
				]) {
					const folded = fold(angle);
					if (angles.some((seen) => sameAngle(seen, folded))) continue;
					angles.push(folded);
					lines.push({ origin: item.loc, angle: folded, kind: "tracking" });
				}
			}
		}
		return lines;
	}

	/** Milliseconds until something arms or is forgotten, or null when nothing will. */
	nextChange(): number | null {
		const now = this.#clock();
		const times: number[] = [];
		if (this.#pending)
			times.push(this.#pending.since + armTime(this.#pending.item));
		for (const { lastUse } of this.#armed) times.push(lastUse + FORGET_MS);
		if (times.length === 0) return null;
		return Math.max(0, Math.min(...times) - now);
	}

	#arm(item: Hovered, now: number) {
		this.#armed.push({ item, lastUse: now });
		const ofKind = this.#armed.filter((a) => a.item.kind === item.kind);
		if (ofKind.length > MAX_ARMED) {
			const oldest = ofKind.reduce((x, y) => (y.lastUse < x.lastUse ? y : x));
			this.#armed = this.#armed.filter((a) => a !== oldest);
		}
	}

	#forget(now: number) {
		this.#armed = this.#armed.filter((a) => now - a.lastUse < FORGET_MS);
	}
}

/** The side or corner a snap is on, to arm: a side (or its midpoint) or a node. */
export function hoveredOf(
	graph: Graph,
	target: SnapTarget | null,
): Hovered | null {
	if (!target) return null;
	if (
		target.kind === "segment" &&
		(!target.mark || target.mark === "midpoint")
	) {
		const { a, b } = target.segment;
		const key = a.id < b.id ? `${a.id} ${b.id}` : `${b.id} ${a.id}`;
		return { kind: "side", key, a: a.loc, b: b.loc };
	}
	if (target.kind === "node") {
		return {
			kind: "corner",
			key: target.id,
			loc: target.loc,
			directions: sideDirections(graph, target.id),
		};
	}
	return null;
}

/** The directions of the sides that meet at a node, in degrees. */
export function sideDirections(graph: Graph, id: NodeId): number[] {
	const node = graph.entity(id);
	if (node?.type !== "node") return [];
	const directions: number[] = [];
	for (const way of graph.parentWays(id)) {
		const ids = way.nodes;
		const closed = ids.length > 2 && ids[0] === ids.at(-1);
		ids.forEach((nodeId, i) => {
			// A closed way's last node is its first again.
			if (nodeId !== id || (closed && i === ids.length - 1)) return;
			const neighbours = [ids[i - 1], ids[i + 1]];
			if (closed && i === 0) neighbours[0] = ids.at(-2);
			for (const other of neighbours) {
				const entity = other && graph.entity(other);
				if (entity?.type === "node" && !same(entity.loc, node.loc))
					directions.push(bearingOf(node.loc, entity.loc));
			}
		});
	}
	return directions;
}

function armTime(item: Hovered): number {
	return item.kind === "side" ? ARM_SIDE_MS : ARM_CORNER_MS;
}

/** An angle folded into [0, 180): a line covers both directions. */
function fold(angle: number): number {
	return ((angle % 180) + 180) % 180;
}

function sameAngle(a: number, b: number): boolean {
	const d = Math.abs(a - b);
	return d < 1e-6 || d > 180 - 1e-6;
}

function same(a: Loc, b: Loc): boolean {
	return a[0] === b[0] && a[1] === b[1];
}
