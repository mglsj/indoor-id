/**
 * The map's features kept from one graph to the next: after an edit only the features of the
 * changed entities, and of those drawn from them, are built again (P5.2). A feature's `@lv`
 * depends on the levels of the whole data, so when those change every feature is encoded
 * again, as in a full build.
 */
import type { FeatureCollection, Geometry } from "geojson";
import RBush from "rbush";
import {
	buildingLevelRefs,
	explicitLevels,
	type LevelEntry,
	type LevelName,
	levelList,
	nonExistentLevels,
	outlineLevelName,
} from "#lib/levels/level-names.ts";
import { isOnLevel, type Levels } from "#lib/levels/levels.ts";
import type { Entity, EntityId, Loc, NodeId, Way } from "#lib/osm/entity.ts";
import { type Extent, extentOf, type Point } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import {
	type BuildOptions,
	draftOf,
	encodeFeature,
	type FeatureDraft,
	type FeatureProperties,
	type IndoorFeature,
	knownLevels,
	listedLevels,
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
	/**
	 * The levels of the features inside `extent`, named, for the level switcher; none when no
	 * feature there is on a level.
	 */
	levelsIn(extent: Extent): LevelEntry[];
}

/** A node of a drawn feature, in the spatial index. */
interface IndexedNode extends Box {
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
	readonly #nodeIndex = new DraftIndex<IndexedNode>(
		() => this.#drafts.keys(),
		(id) => this.#nodes(id),
	);
	/** What each drawn feature says about levels, by extent, for the level switcher. */
	readonly #levelIndex = new DraftIndex<LevelItem>(
		() => this.#drafts.keys(),
		(id) => {
			const draft = this.#drafts.get(id);
			const item = draft && levelItemOf(draft);
			return item ? [item] : [];
		},
	);

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
			this.#nodeIndex.reset();
			this.#levelIndex.reset();
			// Encoded below, once the levels of the data are known.
			for (const entity of graph.entities()) this.#redraft(entity.id, false);
		} else {
			for (const id of affectedBy(changed, graph, previous as Graph)) {
				this.#redraft(id);
			}
		}

		const levels = knownLevels([...this.#drafts.values()].map(listedLevels));
		if (whole || !sameNumbers(levels, this.#levels)) {
			this.#levels = levels;
			this.#features.clear();
			for (const [id, draft] of this.#drafts) {
				this.#features.set(id, encodeFeature(draft, levels));
			}
		}
		const features = this.#features;
		const nodeIndex = this.#nodeIndex;
		const levelIndex = this.#levelIndex;
		const result: StoredFeatures = {
			nodesNear(extent, level) {
				const found = new Map<NodeId, Loc>();
				const hits = nodeIndex.search(extent);
				for (const node of hits) {
					if (!node.levels || isOnLevel(node.levels, level)) {
						found.set(node.id, node.loc);
					}
				}
				return [...found].map(([id, loc]) => ({ id, loc }));
			},
			levelsIn(extent) {
				return levelsOf(levelIndex.search(extent), extent);
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
		this.#nodeIndex.changed(id);
		this.#levelIndex.changed(id);
		if (draft) {
			this.#drafts.set(id, draft);
			if (encode) this.#features.set(id, encodeFeature(draft, this.#levels));
		} else {
			this.#drafts.delete(id);
			this.#features.delete(id);
		}
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

/** A box in the spatial indexes. */
interface Box {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

/**
 * An rbush of the items drawn from each feature, brought up to date only when searched: the
 * features changed since are indexed again, or all of them after most changed.
 */
class DraftIndex<T extends Box> {
	readonly #index = new RBush<T>();
	readonly #items = new Map<EntityId, T[]>();
	/** Entities whose items the index holds as they were, or all of them (null). */
	#unindexed: Set<EntityId> | null = null;
	readonly #ids: () => Iterable<EntityId>;
	readonly #itemsOf: (id: EntityId) => T[];

	constructor(ids: () => Iterable<EntityId>, itemsOf: (id: EntityId) => T[]) {
		this.#ids = ids;
		this.#itemsOf = itemsOf;
	}

	/** Every feature may have changed. */
	reset(): void {
		this.#unindexed = null;
	}

	changed(id: EntityId): void {
		this.#unindexed?.add(id);
	}

	search(extent: Extent): T[] {
		return this.#updated().search({
			minX: extent.west,
			minY: extent.south,
			maxX: extent.east,
			maxY: extent.north,
		});
	}

	#updated(): RBush<T> {
		const unindexed = this.#unindexed;
		if (!unindexed || unindexed.size > this.#items.size / 4) {
			this.#index.clear();
			this.#items.clear();
			for (const id of this.#ids()) {
				const items = this.#itemsOf(id);
				if (items.length > 0) this.#items.set(id, items);
			}
			this.#index.load([...this.#items.values()].flat());
		} else {
			for (const id of unindexed) {
				for (const item of this.#items.get(id) ?? []) this.#index.remove(item);
				const items = this.#itemsOf(id);
				if (items.length > 0) this.#items.set(id, items);
				else this.#items.delete(id);
				for (const item of items) this.#index.insert(item);
			}
		}
		this.#unindexed = new Set();
		return this.#index;
	}
}

/** What a drawn feature says about levels, in the level index. */
interface LevelItem extends Box {
	/** The levels it brings to the switcher (see `listedLevels`). */
	readonly levels: Levels | null;
	readonly explicit: readonly number[];
	/** Names from an `indoor=level` outline. */
	readonly outline?: LevelEntry;
	/** Names from a building's `building:levels:ref`. */
	readonly refs?: ReadonlyMap<number, string>;
	readonly nonExistent?: Levels;
}

function levelItemOf(draft: FeatureDraft): LevelItem | null {
	const tags = draft.properties;
	const levels = listedLevels(draft);
	const outline = outlineLevelName(tags) ?? undefined;
	const refs = buildingLevelRefs(tags);
	const nonExistent = nonExistentLevels(tags) ?? undefined;
	if (!levels && !outline && refs.size === 0 && !nonExistent) return null;
	const extent = extentOf(positions(draft.geometry));
	if (!extent) return null;
	return {
		minX: extent.west,
		minY: extent.south,
		maxX: extent.east,
		maxY: extent.north,
		levels,
		explicit: levels ? explicitLevels(tags) : [],
		...(outline && { outline }),
		...(refs.size > 0 && { refs }),
		...(nonExistent && { nonExistent }),
	};
}

/**
 * The switcher's levels from the items in `extent`. Names of the features nearest its centre
 * win; an `indoor=level` outline's over a building's.
 */
function levelsOf(items: LevelItem[], extent: Extent): LevelEntry[] {
	const levelled = items.filter((i) => i.levels);
	if (levelled.length === 0) return [];
	const x = (extent.west + extent.east) / 2;
	const y = (extent.south + extent.north) / 2;
	const distance = (i: LevelItem) =>
		Math.hypot(
			Math.max(i.minX - x, 0, x - i.maxX),
			Math.max(i.minY - y, 0, y - i.maxY),
		);
	// Only the few features that name levels are sorted.
	const nearest = items
		.filter((i) => i.outline || i.refs)
		.sort((a, b) => distance(a) - distance(b));
	const names = new Map<number, LevelName>();
	for (const { outline } of nearest) {
		if (outline && !names.has(outline.level)) {
			const { level, ...name } = outline;
			names.set(level, name);
		}
	}
	for (const { refs } of nearest) {
		for (const [level, ref] of refs ?? []) {
			if (!names.has(level)) names.set(level, { ref });
		}
	}
	return levelList({
		levels: knownLevels(levelled.map((i) => i.levels)),
		explicit: new Set(levelled.flatMap((i) => i.explicit)),
		names,
		nonExistent: items.flatMap((i) => (i.nonExistent ? [i.nonExistent] : [])),
	});
}

/** Every position of a geometry. */
function positions(geometry: Geometry): Point[] {
	switch (geometry.type) {
		case "Point":
			return [geometry.coordinates];
		case "MultiPoint":
		case "LineString":
			return geometry.coordinates;
		case "MultiLineString":
		case "Polygon":
			return geometry.coordinates.flat();
		case "MultiPolygon":
			return geometry.coordinates.flat(2);
		case "GeometryCollection":
			return geometry.geometries.flatMap(positions);
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
 * of a node and their relations, the nodes of a way (a point turns into a vertex, a vertex
 * takes the way's levels), the members of a relation and their nodes (its `level` reaches
 * them) and the relations of anything.
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
					for (const member of entity.members) {
						affected.add(member.ref);
						const way = g.entity(member.ref);
						if (way?.type === "way") for (const n of way.nodes) affected.add(n);
					}
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
