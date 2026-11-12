/**
 * Which features were edited, and how, for iD's "Highlight changes" (`svg/lines.js`,
 * `svg/areas.js`): added, retagged, or reshaped (moved nodes, nodes added or removed). A way
 * whose untagged nodes moved counts as reshaped, as do the ways using a moved tagged node.
 * Pure.
 */
import { type EntityId, sameContent, sameTags } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { EditKind } from "./style/layers.ts";

export function editedFeatures(graph: Graph): Map<EntityId, EditKind> {
	const edited = new Map<EntityId, EditKind>();
	const base = graph.base();
	const { created, modified } = graph.changes();
	for (const entity of created) edited.set(entity.id, "added");
	const reshaped = (id: EntityId) => {
		if (!edited.has(id)) edited.set(id, "geometry");
	};
	for (const entity of modified) {
		const before = base.entity(entity.id);
		if (before && !sameTags(before.tags, entity.tags)) {
			edited.set(entity.id, "retagged");
		}
	}
	for (const entity of modified) {
		const before = base.entity(entity.id);
		if (entity.type === "node") {
			const moved =
				before?.type === "node" &&
				(before.loc[0] !== entity.loc[0] || before.loc[1] !== entity.loc[1]);
			if (!moved) continue;
			if (Object.keys(entity.tags).length > 0) reshaped(entity.id);
			for (const way of graph.parentWays(entity.id)) reshaped(way.id);
		} else if (
			before &&
			!sameContent({ ...entity, tags: before.tags }, before)
		) {
			reshaped(entity.id);
		}
	}
	return edited;
}
