/**
 * iD's guard against editing what can't be seen (`operations/*.js`, `too_large`): moving,
 * rotating, squaring or deleting features is refused while less than 80% of their extent is in
 * view, so a large area grabbed from inside isn't moved or changed by accident. Pure.
 */
import type { EntityId } from "#lib/osm/entity.ts";
import { type Extent, extentOf } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import { entityExtent } from "#lib/osm/relations.ts";

/** The share of features' extent that must be in view to edit them (iD's 0.8). */
export const MIN_VISIBLE_SHARE = 0.8;

/**
 * The share of `extent` inside `view`, from 0 to 1. A side of no length (a straight line, a
 * point) counts as fully in or out along it.
 */
export function visibleShare(extent: Extent, view: Extent): number {
	const along = (min: number, max: number, from: number, to: number) => {
		if (max <= min) return min >= from && min <= to ? 1 : 0;
		return Math.max(0, Math.min(max, to) - Math.max(min, from)) / (max - min);
	};
	return (
		along(extent.west, extent.east, view.west, view.east) *
		along(extent.south, extent.north, view.south, view.north)
	);
}

/** Whether too little of the features is in view to edit them; never without a view. */
export function tooLargeToEdit(
	graph: Graph,
	ids: readonly EntityId[],
	view: Extent | undefined,
): boolean {
	if (!view || ids.length === 0) return false;
	const corners = ids.flatMap((id) => {
		const extent = entityExtent(graph, id);
		return extent
			? [
					[extent.west, extent.south],
					[extent.east, extent.north],
				]
			: [];
	});
	const extent = extentOf(corners);
	return extent !== null && visibleShare(extent, view) < MIN_VISIBLE_SHARE;
}
