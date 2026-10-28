/**
 * The building and indoor outlines of a graph, by position, for the checks that depend on
 * where a feature is (inside a room, on the outer wall). Kept from one graph to the next like
 * the map's features: after an edit only the outlines it touched are indexed again.
 */
import RBush from "rbush";
import { featureLevels } from "#lib/levels/feature-levels.ts";
import type { Levels } from "#lib/levels/levels.ts";
import {
	type EntityId,
	entityType,
	type Loc,
	type Way,
	type WayId,
} from "#lib/osm/entity.ts";
import {
	distanceToLine,
	type Extent,
	extentOf,
	isClosedRing,
	type Point,
	pointInRing,
	wayLocs,
} from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";

/** Indoor values drawn as spaces a feature can be in. */
const INDOOR_SPACES = new Set(["room", "area", "corridor", "level"]);

export interface Outline {
	readonly id: WayId;
	/** Whether the way outlines a building (`building=*` other than `no`). */
	readonly building: boolean;
	/** Its `indoor=room|area|corridor|level`, if any. */
	readonly indoor?: string;
	readonly ring: readonly Loc[];
	readonly extent: Extent;
	/** Its levels (own tags or parent relations), or null without any. */
	readonly levels: Levels | null;
}

interface Item {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
	readonly outline: Outline;
}

/** Degrees of latitude per metre, near enough for a search box. */
const DEGREES_PER_METRE = 1 / 111_000;

export class Outlines {
	#graph: Graph | null = null;
	readonly #index = new RBush<Item>();
	readonly #items = new Map<EntityId, Item>();

	/** The outlines of `graph`, indexed at once. */
	static of(graph: Graph): Outlines {
		const outlines = new Outlines();
		outlines.update(graph);
		return outlines;
	}

	/**
	 * Follows `graph`, indexing again only the ways an edit since the last call touched (all
	 * of them the first time, or after most of the data changed). Returns the extents of the
	 * outlines that changed, as they were and as they are.
	 */
	update(graph: Graph): Extent[] {
		const previous = this.#graph;
		this.#graph = graph;
		if (previous === graph) return [];
		const changed = previous ? graph.changedSince(previous) : null;
		if (!previous || !changed || changed.size > this.#items.size / 2 + 100) {
			const extents = [...this.#items.values()].map((i) => i.outline.extent);
			this.#index.clear();
			this.#items.clear();
			const items: Item[] = [];
			for (const entity of graph.entities()) {
				if (entity.type !== "way") continue;
				const item = itemOf(graph, entity);
				if (!item) continue;
				items.push(item);
				this.#items.set(entity.id, item);
			}
			this.#index.load(items);
			return [...extents, ...items.map((i) => i.outline.extent)];
		}
		const ways = new Set<WayId>();
		for (const id of changed) {
			for (const g of [previous, graph]) {
				const entity = g.entity(id);
				if (entity?.type === "way") ways.add(entity.id);
				else if (entity?.type === "node") {
					for (const way of g.parentWays(entity.id)) ways.add(way.id);
				} else if (entity?.type === "relation") {
					// A multipolygon's level is its outer ways'.
					for (const m of entity.members) {
						if (entityType(m.ref) === "way") ways.add(m.ref as WayId);
					}
				}
			}
		}
		const extents: Extent[] = [];
		for (const id of ways) {
			const old = this.#items.get(id);
			if (old) {
				this.#index.remove(old);
				this.#items.delete(id);
				extents.push(old.outline.extent);
			}
			const way = graph.entity(id);
			const item = way?.type === "way" ? itemOf(graph, way) : null;
			if (item) {
				this.#index.insert(item);
				this.#items.set(id, item);
				extents.push(item.outline.extent);
			}
		}
		return extents;
	}

	/** The outline of a way, if it is one. */
	get(id: EntityId): Outline | undefined {
		return this.#items.get(id)?.outline;
	}

	/** The outlines whose area holds `point`. */
	at(point: Point): Outline[] {
		const [x = 0, y = 0] = point;
		return this.#index
			.search({ minX: x, minY: y, maxX: x, maxY: y })
			.map((i) => i.outline)
			.filter((o) => pointInRing(point, o.ring));
	}

	/** The outlines whose line passes within `metres` of `point`. */
	near(point: Point, metres: number): Outline[] {
		const [x = 0, y = 0] = point;
		const dy = metres * DEGREES_PER_METRE;
		const dx = dy / Math.max(Math.cos((y * Math.PI) / 180), 0.01);
		return this.#index
			.search({ minX: x - dx, minY: y - dy, maxX: x + dx, maxY: y + dy })
			.map((i) => i.outline)
			.filter((o) => distanceToLine(point, o.ring) <= metres);
	}

	/** The outlines whose extent overlaps `extent`. */
	within(extent: Extent): Outline[] {
		return this.#index
			.search({
				minX: extent.west,
				minY: extent.south,
				maxX: extent.east,
				maxY: extent.north,
			})
			.map((i) => i.outline);
	}
}

function itemOf(graph: Graph, way: Way): Item | null {
	const { tags } = way;
	const building = tags.building !== undefined && tags.building !== "no";
	const indoor =
		tags.indoor !== undefined && INDOOR_SPACES.has(tags.indoor)
			? tags.indoor
			: undefined;
	if ((!building && !indoor) || !isClosedRing(way)) return null;
	const ring = wayLocs(graph, way);
	const extent = extentOf(ring);
	if (!extent || ring.length < 4) return null;
	const outline: Outline = {
		id: way.id,
		building,
		indoor,
		ring,
		extent,
		levels: indoor
			? featureLevels(tags, () =>
					graph.parentRelations(way.id).map((r) => r.tags),
				)
			: null,
	};
	return {
		minX: extent.west,
		minY: extent.south,
		maxX: extent.east,
		maxY: extent.north,
		outline,
	};
}
