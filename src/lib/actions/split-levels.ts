/**
 * One feature per level from a way on several (the W leftover, P5.3's copies): the way keeps
 * the lowest level, and each other level gets a copy with the same tags and the same nodes, so
 * the rooms stay joined to each other and to the walls they share. As osm-simple3d-editor's
 * "separate copies" for Repeat on levels.
 */
import type { WayId } from "#lib/osm/entity.ts";
import { type Graph, getEntity } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";

/** Splits way `id` into one way per level of `levels` (at least two, the lowest kept). */
export function onePerLevel(id: WayId, levels: readonly number[]): Action {
	return (graph: Graph) => {
		const way = getEntity(graph, id, "way");
		const [lowest, ...others] = [...levels].sort((a, b) => a - b);
		if (lowest === undefined) return graph;
		let g = graph.replace({
			...way,
			tags: { ...way.tags, level: String(lowest) },
		});
		for (const level of others) {
			g = g.replace({
				type: "way",
				id: g.newId("way"),
				nodes: way.nodes,
				tags: { ...way.tags, level: String(level) },
			});
		}
		return g;
	};
}
