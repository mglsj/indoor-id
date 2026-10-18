/**
 * The map's features kept from one graph to the next: after an edit only the features of the
 * changed entities, and of those drawn from them, are built again (P5.2). A feature's `@lv`
 * depends on the levels of the whole data, so when those change every feature is encoded
 * again, as in a full build.
 */
import type { FeatureCollection, Geometry } from "geojson";
import RBush from "rbush";
import { isOnLevel, type Levels } from "#lib/levels/levels.ts";
import type { Entity, EntityId, Loc, NodeId, Way } from "#lib/osm/entity.ts";
import type { Extent } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import {
	type BuildOptions,
	draftOf,
	encodeFeature,
	type FeatureDraft,
	type FeatureProperties,
	type IndoorFeature,
	knownLevels,
} from "./features.ts";

export interface StoredFeatures {
	/** Every feature by entity id; a feature left alone stays the same object. */
	readonly byId: ReadonlyMap<string, IndoorFeature>;
	/** Every level present in the data, sorted (see `buildFeatures`). */
	readonly levels: number[];
	/** All the features, for a full `setData`. */
	readonly collection: FeatureCollection<Geometry, FeatureProperties>;
	/**
	 * The nodes of the features drawn on `level` (or without a level) inside `extent`, once
	 * each: what a click can snap to.
	 */
	nodesNear(extent: Extent, level: number): { id: NodeId; loc: Loc }[];
}

/** A node of a drawn feature, in the spatial index. */
interface IndexedNode {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
	readonly id: NodeId;
	readonly loc: Loc;
	readonly levels: Levels | null;
}

export class FeatureStore {
	#graph: Graph | null = null;
	#options: BuildOptions = {};
	readonly #drafts = new Map<EntityId, FeatureDraft>();
	readonly #features = new Map<string, IndoorFeature>();
	#levels: number[] = [];
	#result: StoredFeatures | null = null;
	/**
	 * The nodes of every drawn feature, by position, with the feature's levels. Kept up to date
	 * only when asked (a snap), not on every edit or download.
	 */
	readonly #index = new RBush<IndexedNode>();
	readonly #indexed = new Map<EntityId, IndexedNode[]>();
	/** Entities whose nodes the index holds as they were, or all of them (null). */
	#unindexed: Set<EntityId> | null = null;

	/** The features of `graph`, building again only what changed since the last call. */
	update(graph: Graph, options: BuildOptions = {}): StoredFeatures {
		const previous = this.#graph;
		const full =
			!previous ||
			options.presets !== this.#options.presets ||
			options.icons !== this.#options.icons;
		this.#graph = graph;
		this.#options = options;
		const changed = full ? null : graph.changedSince(previous);
		if (changed?.size === 0 && this.#result) return this.#result;
		// A download of most of the data is rebuilt whole: quicker than following each change.
		const whole = !changed || changed.size > this.#drafts.size / 2;
		if (whole) {
			this.#drafts.clear();
			this.#features.clear();
			this.#unindexed = null;
			// Encoded below, once the levels of the data are known.
			for (const entity of graph.entities()) this.#redraft(entity.id, false);
		} else {
			for (const id of affectedBy(changed, graph, previous as Graph)) {
				this.#redraft(id);
			}
		}

		const levels = knownLevels([...this.#drafts.values()].map((d) => d.levels));
		if (whole || !sameNumbers(levels, this.#levels)) {
			this.#levels = levels;
			this.#features.clear();
			for (const [id, draft] of this.#drafts) {
				this.#features.set(id, encodeFeature(draft, levels));
			}
		}
		const features = this.#features;
		const index = () => this.#updatedIndex();
		const result: StoredFeatures = {
			nodesNear(extent, level) {
				const found = new Map<NodeId, Loc>();
				const hits = index().search({
					minX: extent.west,
					minY: extent.south,
					maxX: extent.east,
					maxY: extent.north,
				});
				for (const node of hits) {
					if (!node.levels || isOnLevel(node.levels, level)) {
						found.set(node.id, node.loc);
					}
				}
				return [...found].map(([id, loc]) => ({ id, loc }));
			},
			byId: features,
			levels: this.#levels,
			get collection() {
				return {
					type: "FeatureCollection" as const,
					features: [...features.values()],
				};
			},
		};
		this.#result = result;
		return result;
	}

	/** Builds an entity's feature again (encoded unless `encode` is false), or drops it. */
	#redraft(id: EntityId, encode = true): void {
		const graph = this.#graph as Graph;
		const entity = graph.entity(id);
		const draft = entity ? draftOf(graph, entity, this.#options) : null;
		this.#unindexed?.add(id);
		if (draft) {
			this.#drafts.set(id, draft);
			if (encode) this.#features.set(id, encodeFeature(draft, this.#levels));
		} else {
			this.#drafts.delete(id);
			this.#features.delete(id);
		}
	}

	/** The node index, brought up to date with the features. */
	#updatedIndex(): RBush<IndexedNode> {
		const unindexed = this.#unindexed;
		if (!unindexed || unindexed.size > this.#drafts.size / 4) {
			this.#index.clear();
			this.#indexed.clear();
			for (const id of this.#drafts.keys())
				this.#indexed.set(id, this.#nodes(id));
			this.#index.load([...this.#indexed.values()].flat());
		} else {
			for (const id of unindexed) {
				for (const node of this.#indexed.get(id) ?? [])
					this.#index.remove(node);
				const nodes = this.#nodes(id);
				if (nodes.length > 0) this.#indexed.set(id, nodes);
				else this.#indexed.delete(id);
				for (const node of nodes) this.#index.insert(node);
			}
		}
		this.#unindexed = new Set();
		return this.#index;
	}

	/** A drawn feature's nodes, for the index; none for an entity not drawn. */
	#nodes(id: EntityId): IndexedNode[] {
		const graph = this.#graph as Graph;
		const entity = graph.entity(id);
		const draft = this.#drafts.get(id);
		if (!entity || !draft) return [];
		return nodesOf(graph, entity).map(([node, loc]) => ({
			minX: loc[0],
			minY: loc[1],
			maxX: loc[0],
			maxY: loc[1],
			id: node,
			loc,
			levels: draft.levels,
		}));
	}
}

/** The nodes a feature is drawn through: its own, its way's, its multipolygon's ways'. */
function nodesOf(graph: Graph, entity: Entity): [NodeId, Loc][] {
	const ofWay = (way: Way) =>
		graph.childNodes(way).map((node): [NodeId, Loc] => [node.id, node.loc]);
	switch (entity.type) {
		case "node":
			return [[entity.id, entity.loc]];
		case "way":
			return ofWay(entity);
		case "relation":
			return entity.members.flatMap((m) => {
				const member = graph.entity(m.ref);
				return member?.type === "way" ? ofWay(member) : [];
			});
	}
}

/**
 * The entities whose features may differ after `changed` changed, in either graph: the ways
 * of a node and their relations, the nodes of a way (a point turns into a vertex), the
 * members of a relation (its `level` reaches them) and the relations of anything.
 */
function affectedBy(
	changed: ReadonlySet<EntityId>,
	graph: Graph,
	previous: Graph,
): Set<EntityId> {
	const affected = new Set(changed);
	for (const id of changed) {
		for (const g of [graph, previous]) {
			const entity = g.entity(id);
			if (!entity) continue;
			switch (entity.type) {
				case "node":
					for (const way of g.parentWays(entity.id)) {
						affected.add(way.id);
						for (const r of g.parentRelations(way.id)) affected.add(r.id);
					}
					break;
				case "way":
					for (const node of entity.nodes) affected.add(node);
					break;
				case "relation":
					for (const member of entity.members) affected.add(member.ref);
					break;
			}
			for (const r of g.parentRelations(id)) affected.add(r.id);
		}
	}
	return affected;
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
	return a.length === b.length && a.every((n, i) => n === b[i]);
}

/** What to send the map so it holds `next`, given that it holds `sent`. */
export function diffFeatures(
	sent: ReadonlyMap<string, IndoorFeature>,
	next: ReadonlyMap<string, IndoorFeature>,
): { add: IndoorFeature[]; remove: string[] } {
	const add: IndoorFeature[] = [];
	const remove: string[] = [];
	for (const [id, feature] of next) {
		if (sent.get(id) !== feature) add.push(feature);
	}
	for (const id of sent.keys()) {
		if (!next.has(id)) remove.push(id);
	}
	return { add, remove };
}
