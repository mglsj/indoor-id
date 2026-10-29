/**
 * Simple multipolygons (P5.3.7), as iD's "merge" into a multipolygon: closed ways become the
 * members of a new `type=multipolygon` relation, or are added to a selected one. A ring inside
 * one other ring is `inner` (a hole: an atrium, a pillar, a courtyard), inside two it is
 * `outer` again (an island), and so on. A new relation takes the tags of its outer ways when
 * they all have the same ones, and those ways lose them (iD's tags-on-the-relation model); a
 * hole that only has the tags drawing gave it (`level`, `area=yes`) loses those.
 */
import type {
	EntityId,
	Member,
	RelationId,
	Way,
	WayId,
} from "#lib/osm/entity.ts";
import { isClosedRing, pointInRing, toMercator } from "#lib/osm/geometry.ts";
import { type Graph, getEntity } from "#lib/osm/graph.ts";
import { hasInterestingTags, type Tags } from "#lib/osm/tags.ts";

export type MultipolygonRefusal =
	| "not_rings"
	| "several_relations"
	| "in_other_multipolygon";

const isMultipolygon = (tags: Tags) => tags.type === "multipolygon";

interface Parts {
	readonly relation: RelationId | null;
	readonly ways: readonly Way[];
}

function partsOf(
	graph: Graph,
	ids: readonly EntityId[],
): Parts | MultipolygonRefusal {
	let relation: RelationId | null = null;
	const ways: Way[] = [];
	for (const id of ids) {
		const entity = graph.entity(id);
		if (entity?.type === "relation" && isMultipolygon(entity.tags)) {
			if (relation) return "several_relations";
			relation = entity.id;
		} else if (entity?.type === "way" && isClosedRing(entity)) {
			ways.push(entity);
		} else {
			return "not_rings";
		}
	}
	if (ways.length === 0 || (!relation && ways.length < 2)) return "not_rings";
	for (const way of ways) {
		const other = graph
			.parentRelations(way.id)
			.find((r) => isMultipolygon(r.tags) && r.id !== relation);
		if (other) return "in_other_multipolygon";
	}
	return { relation, ways };
}

export function multipolygonRefusal(
	graph: Graph,
	ids: readonly EntityId[],
): MultipolygonRefusal | null {
	const parts = partsOf(graph, ids);
	return typeof parts === "string" ? parts : null;
}

/**
 * Makes the multipolygon. Returns the graph and the relation, made or added to (the one to
 * select after).
 */
export function makeMultipolygon(
	graph: Graph,
	ids: readonly EntityId[],
): { graph: Graph; relation: RelationId } | null {
	const parts = partsOf(graph, ids);
	if (typeof parts === "string") return null;
	let g = graph;
	const existing = parts.relation
		? getEntity(g, parts.relation, "relation")
		: null;
	const known = new Set(existing?.members.map((m) => m.ref));
	const memberWays = existing
		? existing.members.flatMap((m) => {
				const w = g.entity(m.ref);
				return w?.type === "way" && isClosedRing(w) ? [w] : [];
			})
		: [];
	const rings = [...memberWays, ...parts.ways.filter((w) => !known.has(w.id))];
	const roleOf = roles(g, rings);
	const added: Member[] = parts.ways
		.filter((w) => !known.has(w.id))
		.map((w) => ({ ref: w.id, role: roleOf.get(w.id) ?? "outer" }));

	// A hole just drawn carries only the drawing's tags (`level`, `area=yes`): a hole has none.
	for (const way of parts.ways) {
		const keys = Object.keys(way.tags);
		if (
			roleOf.get(way.id) === "inner" &&
			keys.length > 0 &&
			keys.every((k) => k === "level" || k === "area")
		)
			g = g.replace({ ...way, tags: {} });
	}

	if (existing) {
		g = g.replace({ ...existing, members: [...existing.members, ...added] });
		return { graph: g, relation: existing.id };
	}

	// The tags of the outer ways go to the relation when they all have the same ones.
	const outers = parts.ways.filter((w) => roleOf.get(w.id) === "outer");
	const tagged = outers.filter((w) => hasInterestingTags(w.tags));
	const [first] = tagged;
	const moved =
		first && tagged.every((w) => sameTags(w.tags, first.tags))
			? first.tags
			: {};
	for (const way of tagged) {
		if (moved === first?.tags) g = g.replace({ ...way, tags: {} });
	}
	const id = g.newId("relation");
	g = g.replace({
		type: "relation",
		id,
		members: added,
		tags: { ...withoutArea(moved), type: "multipolygon" },
	});
	return { graph: g, relation: id };
}

/** Each ring's role: inside an odd number of the other rings, inner; else outer. */
function roles(
	graph: Graph,
	rings: readonly Way[],
): Map<WayId, "inner" | "outer"> {
	const points = new Map(
		rings.map((w) => [
			w.id,
			w.nodes.map((n) => toMercator(getEntity(graph, n, "node").loc)),
		]),
	);
	const result = new Map<WayId, "inner" | "outer">();
	for (const way of rings) {
		const own = points.get(way.id) ?? [];
		const depth = rings.filter(
			(other) =>
				other.id !== way.id &&
				own.every((p) => pointInRing(p, points.get(other.id) ?? [])),
		).length;
		result.set(way.id, depth % 2 === 1 ? "inner" : "outer");
	}
	return result;
}

/** `area=yes` says a closed way is an area: a multipolygon is one already. */
function withoutArea(tags: Tags): Tags {
	const { area: _area, ...rest } = tags;
	return rest;
}

function sameTags(a: Tags, b: Tags): boolean {
	const keys = Object.keys(a);
	return (
		keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
	);
}
