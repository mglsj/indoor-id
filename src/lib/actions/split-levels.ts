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

/**
 * One flight per pair of adjacent levels from stairs or an escalator on three or more (W2,
 * osm-simple3d-editor `602503d`): the way keeps the lowest pair (`0;1`), and each next pair
 * (`1;2`, `2;3`) gets a copy with the same tags and nodes.
 */
export function onePerLevelPair(id: WayId, levels: readonly number[]): Action {
	return (graph: Graph) => {
		const way = getEntity(graph, id, "way");
		const sorted = [...levels].sort((a, b) => a - b);
		const pairs = sorted.slice(1).map((upper, i) => `${sorted[i]};${upper}`);
		const [first, ...others] = pairs;
		if (first === undefined) return graph;
		let g = graph.replace({ ...way, tags: { ...way.tags, level: first } });
		for (const level of others) {
			g = g.replace({
				type: "way",
				id: g.newId("way"),
				nodes: way.nodes,
				tags: { ...way.tags, level },
			});
		}
		return g;
	};
}
