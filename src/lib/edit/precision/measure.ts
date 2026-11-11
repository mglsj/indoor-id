/**
 * Measurements of a selected feature (C.1, iD's measurement panel): a line's length, an
 * area's perimeter and area, and the length of each side. In metres, flat around the first
 * corner (fine for a building).
 */
import type { EntityId } from "#lib/osm/entity.ts";
import { isClosed, local, wayLocs } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import { lengthOf } from "./frame.ts";

export interface Measurements {
	/** Metres around a closed way, or along a line. */
	readonly length: number;
	/** Square metres inside a closed way; undefined for a line. */
	readonly area?: number;
	/** Each side's metres, in order. */
	readonly sides: readonly number[];
}

/** A way's measurements, or null for anything else (or a way without two corners). */
export function measure(graph: Graph, id: EntityId): Measurements | null {
	const way = graph.entity(id);
	if (way?.type !== "way") return null;
	const locs = wayLocs(graph, way);
	if (locs.length < 2) return null;
	const sides: number[] = [];
	for (let i = 1; i < locs.length; i++) {
		sides.push(lengthOf(locs[i - 1] ?? [0, 0], locs[i] ?? [0, 0]));
	}
	const length = sides.reduce((sum, side) => sum + side, 0);
	if (!isClosed(way) || locs.length < 4) return { length, sides };
	const origin = locs[0] ?? [0, 0];
	let twice = 0;
	for (let i = 1; i < locs.length; i++) {
		const [x0, y0] = local(origin, locs[i - 1] ?? origin);
		const [x1, y1] = local(origin, locs[i] ?? origin);
		twice += x0 * y1 - x1 * y0;
	}
	return { length, area: Math.abs(twice) / 2, sides };
}
