/**
 * Repeat on levels (P5.3.5), as osm-simple3d-editor's: a point or way on the level shown is
 * put on other levels too, one of three ways:
 * - `copies` (the default): a copy on each level, with the same tags but `level`, reusing the
 *   nodes found at the same positions on that level (the copy shares corners with the rooms
 *   and walls there, and with untagged outlines);
 * - `repeat_on`: the feature stays one, `repeat_on` lists the other levels;
 * - `level`: the feature stays one, `level` lists them all (`0;1;2`).
 * Copies already there (same tags but `level`, same positions) count as done; a level left
 * out loses its copy. Switching methods replaces the copies or the tags of the other one.
 */
import {
	formatLevels,
	normalizeLevels,
	parseLevels,
} from "#lib/levels/levels.ts";
import type {
	Entity,
	EntityId,
	Loc,
	Node,
	NodeId,
	Way,
} from "#lib/osm/entity.ts";
import { type Graph, getEntity } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";
import type { Tags } from "#lib/osm/tags.ts";
import { deleteEntities } from "./delete.ts";

export type RepeatMethod = "copies" | "repeat_on" | "level";

/** The drawn nodes on a level near the feature (the feature store's `nodesNear`). */
export type NodesOnLevel = (
	level: number,
) => readonly { id: NodeId; loc: Loc }[];

/** What the feature repeats on now: the method, the other levels, and copies by level. */
export interface Repeat {
	readonly method: RepeatMethod;
	readonly levels: readonly number[];
	readonly copies: ReadonlyMap<number, EntityId>;
}

/** Whether `id` can be repeated from `level`: a point or way on that level only, or on it and more. */
export function canRepeat(graph: Graph, id: EntityId, level: number): boolean {
	const entity = graph.entity(id);
	if (!entity || entity.type === "relation") return false;
	if (entity.type === "node" && graph.parentWays(entity.id).length > 0)
		return false;
	const levels = parseLevels(entity.tags.level ?? "");
	return levels?.some((r) => r.min <= level && level <= r.max) === true;
}

/** Which other levels a feature is on now, and how (see `Repeat`). */
export function currentRepeat(
	graph: Graph,
	id: EntityId,
	level: number,
	candidates: readonly number[],
	near: NodesOnLevel,
): Repeat {
	const entity = graph.entity(id) as Node | Way;
	const repeatOn = entity.tags.repeat_on;
	if (repeatOn !== undefined) {
		return {
			method: "repeat_on",
			levels: listed(repeatOn).filter((l) => l !== level),
			copies: new Map(),
		};
	}
	const own = listed(entity.tags.level ?? "");
	if (own.length > 1) {
		return {
			method: "level",
			levels: own.filter((l) => l !== level),
			copies: new Map(),
		};
	}
	const copies = new Map<number, EntityId>();
	for (const other of candidates) {
		if (other === level) continue;
		const copy = findCopy(graph, entity, other, near(other));
		if (copy) copies.set(other, copy);
	}
	return { method: "copies", levels: [...copies.keys()], copies };
}

/** Puts the feature on `level` and on `wanted.levels` as `wanted.method` says. */
export function repeatOnLevels(
	id: EntityId,
	level: number,
	wanted: { method: RepeatMethod; levels: readonly number[] },
	now: Repeat,
	near: NodesOnLevel,
): Action {
	return (graph: Graph) => {
		let g = graph;
		const others = [...new Set(wanted.levels)]
			.filter((l) => l !== level)
			.sort((a, b) => a - b);
		const entity = g.entity(id) as Node | Way;
		const { repeat_on: _repeat, ...rest } = entity.tags;
		const tags: Record<string, string> = { ...rest, level: String(level) };
		if (wanted.method === "repeat_on" && others.length > 0) {
			tags.repeat_on = format(others);
		}
		if (wanted.method === "level") tags.level = format([level, ...others]);
		if (!sameTags(tags, entity.tags)) g = g.replace({ ...entity, tags });

		const keep =
			wanted.method === "copies" ? new Set(others) : new Set<number>();
		const gone = [...now.copies]
			.filter(([l]) => !keep.has(l))
			.map(([, c]) => c);
		if (gone.length > 0) g = deleteEntities(gone)(g);
		for (const other of keep) {
			if (now.copies.has(other)) continue;
			g = addCopy(g, g.entity(id) as Node | Way, other, near(other));
		}
		return g;
	};
}

function addCopy(
	graph: Graph,
	entity: Node | Way,
	level: number,
	near: readonly { id: NodeId; loc: Loc }[],
): Graph {
	let g = graph;
	const onLevel = (tags: Tags): Tags => ({
		...withoutLevel(tags),
		level: String(level),
	});
	if (entity.type === "node") {
		const id = g.newId("node");
		return g.replace({
			type: "node",
			id,
			loc: entity.loc,
			tags: onLevel(entity.tags),
		});
	}
	const at = new Map(near.map((n) => [key(n.loc), n.id]));
	const copies = new Map<NodeId, NodeId>();
	const nodes = entity.nodes.map((n) => {
		const known = copies.get(n);
		if (known) return known;
		const source = getEntity(g, n, "node");
		let id = at.get(key(source.loc));
		if (!id) {
			id = g.newId("node");
			const tags =
				source.tags.level === undefined ? source.tags : onLevel(source.tags);
			g = g.replace({ type: "node", id, loc: source.loc, tags });
		}
		copies.set(n, id);
		return id;
	});
	const id = g.newId("way");
	return g.replace({ type: "way", id, nodes, tags: onLevel(entity.tags) });
}

/** A copy of `entity` on `level` among the nodes there (and their ways), if any. */
function findCopy(
	graph: Graph,
	entity: Node | Way,
	level: number,
	near: readonly { id: NodeId; loc: Loc }[],
): EntityId | null {
	const isCopy = (other: Entity) =>
		other.id !== entity.id &&
		other.tags.level === String(level) &&
		sameTags(withoutLevel(other.tags), withoutLevel(entity.tags));
	if (entity.type === "node") {
		const hit = near.find(
			(n) =>
				key(n.loc) === key(entity.loc) &&
				isCopy(getEntity(graph, n.id, "node")),
		);
		return hit?.id ?? null;
	}
	const shape = entity.nodes.map((n) => key(getEntity(graph, n, "node").loc));
	for (const n of near) {
		if (key(n.loc) !== shape[0]) continue;
		for (const way of graph.parentWays(n.id)) {
			if (!isCopy(way) || way.nodes.length !== shape.length) continue;
			const locs = way.nodes.map((m) => key(getEntity(graph, m, "node").loc));
			if (sameShape(locs, shape)) return way.id;
		}
	}
	return null;
}

/** The same positions in the same order, or reversed. */
function sameShape(a: readonly string[], b: readonly string[]): boolean {
	const forward = a.every((k, i) => k === b[i]);
	const reversed = a.every((k, i) => k === b[b.length - 1 - i]);
	return forward || reversed;
}

/** A position as a key, to the 1e-7° (about a centimetre) OSM keeps. */
function key([lon, lat]: Loc): string {
	return `${lon.toFixed(7)} ${lat.toFixed(7)}`;
}

function withoutLevel(tags: Tags): Tags {
	const { level: _level, repeat_on: _repeat, ...rest } = tags;
	return rest;
}

function sameTags(a: Tags, b: Tags): boolean {
	const ka = Object.keys(a);
	return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/** The single levels a value lists (ranges count by whole levels). */
function listed(value: string): number[] {
	const levels = parseLevels(value) ?? [];
	return levels.flatMap(({ min, max }) => {
		if (min === max) return [min];
		const all: number[] = [];
		for (let l = Math.ceil(min); l <= max; l++) all.push(l);
		return all;
	});
}

function format(levels: readonly number[]): string {
	return formatLevels(normalizeLevels(levels.map((l) => ({ min: l, max: l }))));
}
