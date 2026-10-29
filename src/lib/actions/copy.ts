/**
 * Copy and paste (P5.3.5), as iD's: copying keeps a snapshot of the points and ways selected,
 * with the nodes of the ways, so later edits don't change what is pasted. Pasting adds new
 * features with new ids, moved so that the copy's centre lands where the pointer is. Vertices
 * (nodes of a way) and relations are left out: a vertex makes no sense on its own, and a
 * relation copied without its members would be broken.
 *
 * A copy whose features are all on one level, pasted while another is shown, goes on the level
 * shown: copying a room to the floor above is the common case.
 */
import { type Levels, parseLevels } from "#lib/levels/levels.ts";
import type {
	Entity,
	EntityId,
	Loc,
	Node,
	NodeId,
	Way,
} from "#lib/osm/entity.ts";
import { extentOf, fromMercator, toMercator } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";

export interface Clipboard {
	/** The features copied, in the order they were selected. */
	readonly roots: readonly (Node | Way)[];
	/** Every node of the ways copied, by id. */
	readonly nodes: ReadonlyMap<NodeId, Node>;
	/** The centre of the copy's extent, which a paste puts at the pointer. */
	readonly center: Loc;
}

/** Whether `id` can be copied: a point (a node in no way) or a way. */
export function canCopy(graph: Graph, id: EntityId): boolean {
	const entity = graph.entity(id);
	return (
		entity?.type === "way" ||
		(entity?.type === "node" && graph.parentWays(entity.id).length === 0)
	);
}

/** A snapshot of the features in `ids` that can be copied, or null when none can. */
export function copyEntities(
	graph: Graph,
	ids: readonly EntityId[],
): Clipboard | null {
	const roots: (Node | Way)[] = [];
	const nodes = new Map<NodeId, Node>();
	for (const id of ids) {
		if (!canCopy(graph, id)) continue;
		const entity = graph.entity(id) as Node | Way;
		roots.push(entity);
		if (entity.type === "way") {
			for (const n of graph.childNodes(entity)) nodes.set(n.id, n);
		}
	}
	const locs = [
		...roots.flatMap((e) => (e.type === "node" ? [e.loc] : [])),
		...[...nodes.values()].map((n) => n.loc),
	];
	const extent = extentOf(locs);
	if (!extent) return null;
	const center = fromMercator(
		midMercator([extent.west, extent.south], [extent.east, extent.north]),
	);
	return { roots, nodes, center };
}

/**
 * Adds a copy of the clipboard's features with their centre at `to`, moved onto `level` when
 * they were all on one other level. Returns the new graph and the ids of the pasted features
 * (not their nodes), to select.
 */
export function pasteEntities(
	graph: Graph,
	clipboard: Clipboard,
	to: Loc,
	level: number,
): { graph: Graph; ids: EntityId[] } {
	const [cx, cy] = toMercator(clipboard.center);
	const [tx, ty] = toMercator(to);
	const move = (loc: Loc): Loc => {
		const [x, y] = toMercator(loc);
		return fromMercator([x + tx - cx, y + ty - cy]);
	};
	const from = sharedLevel(clipboard);
	const onLevel = (entity: Entity) =>
		from !== null && from !== level && entity.tags.level !== undefined
			? { ...entity.tags, level: String(level) }
			: entity.tags;

	let g = graph;
	const copies = new Map<NodeId, NodeId>();
	const copyNode = (node: Node): NodeId => {
		const known = copies.get(node.id);
		if (known) return known;
		const id = g.newId("node");
		copies.set(node.id, id);
		g = g.replace({
			type: "node",
			id,
			loc: move(node.loc),
			tags: onLevel(node),
		});
		return id;
	};
	const ids: EntityId[] = [];
	for (const root of clipboard.roots) {
		if (root.type === "node") {
			ids.push(copyNode(root));
			continue;
		}
		const nodes = root.nodes.map((n) => {
			const node = clipboard.nodes.get(n);
			return node ? copyNode(node) : n;
		});
		const id = g.newId("way");
		g = g.replace({ type: "way", id, nodes, tags: onLevel(root) });
		ids.push(id);
	}
	return { graph: g, ids };
}

/** The one level every copied feature with a `level` tag is on, or null. */
function sharedLevel(clipboard: Clipboard): number | null {
	const values = new Set(
		[...clipboard.roots, ...clipboard.nodes.values()]
			.map((e) => e.tags.level)
			.filter((v) => v !== undefined),
	);
	if (values.size !== 1) return null;
	const [value] = values;
	const levels: Levels | null = parseLevels(value ?? "");
	const [range] = levels ?? [];
	return levels?.length === 1 && range && range.min === range.max
		? range.min
		: null;
}

function midMercator(a: Loc, b: Loc): [number, number] {
	const [ax, ay] = toMercator(a);
	const [bx, by] = toMercator(b);
	return [(ax + bx) / 2, (ay + by) / 2];
}
