/**
 * Times the editor's core on a synthetic area of 10,000 rooms (50,000 entities), the size P5
 * was measured on: building the map's features, one tag edit, deleting 1,000 rooms, and
 * snapping a click to a node. Run with `bun run bench`; the numbers are checked by hand.
 *
 * Targets (P5.2): a tag edit to map update under 16 ms, deleting 1,000 rooms under 150 ms,
 * a snap lookup under 1 ms, the first full build no slower than before. R1.12: one more edit
 * after 10,000 local edits (each its own undo step) under a frame, 16 ms. R4.4: a downloaded
 * tile merged under 500 and 10,000 undo steps (every step is rebased onto the new data), and
 * the full `changes()` scan the Save dialog's issues run, before P5.4a fixes the saved history.
 */
import { changeTags } from "#lib/actions/change-tags.ts";
import { deleteEntities } from "#lib/actions/delete.ts";
import { diffFeatures, FeatureStore } from "#lib/map/feature-store.ts";
import { buildFeatures } from "#lib/map/features.ts";
import type { Entity, Loc, NodeId, WayId } from "#lib/osm/entity.ts";
import { Graph } from "#lib/osm/graph.ts";
import { History } from "#lib/osm/history.ts";
import { loadPresetIndex } from "#lib/presets/load.ts";

const SIDE = 100; // rooms per row: 100 × 100 rooms
const SIZE = 0.0001; // degrees per room
const LEVELS = 5;

/** Rooms on a grid, each with its own four nodes, spread over levels 0 to 4. */
function syntheticArea(): Entity[] {
	const entities: Entity[] = [];
	let id = 1;
	for (let row = 0; row < SIDE; row++) {
		for (let col = 0; col < SIDE; col++) {
			const x = 2.35 + col * SIZE;
			const y = 48.85 + row * SIZE;
			const corners: Loc[] = [
				[x, y],
				[x + SIZE * 0.9, y],
				[x + SIZE * 0.9, y + SIZE * 0.9],
				[x, y + SIZE * 0.9],
			];
			const nodes = corners.map((loc): NodeId => {
				const node = `n${id++}` as NodeId;
				entities.push({ type: "node", id: node, version: 1, tags: {}, loc });
				return node;
			});
			entities.push({
				type: "way",
				id: `w${id++}` as WayId,
				version: 1,
				nodes: [...nodes, nodes[0] as NodeId],
				tags: {
					indoor: "room",
					level: String((row + col) % LEVELS),
					name: `Room ${row}.${col}`,
				},
			});
		}
	}
	return entities;
}

/** A downloaded tile: `rooms` rooms east of the area, with ids after `first`. */
function tile(first: number, rooms: number): Entity[] {
	const entities: Entity[] = [];
	let id = first;
	for (let i = 0; i < rooms; i++) {
		const x = 2.4 + (first / 5 + i) * SIZE;
		const nodes = [0, 1, 2].map((k): NodeId => {
			const node = `n${id++}` as NodeId;
			entities.push({
				type: "node",
				id: node,
				version: 1,
				tags: {},
				loc: [x + k * SIZE * 0.3, 48.85 + (k % 2) * SIZE * 0.5],
			});
			return node;
		});
		entities.push({
			type: "way",
			id: `w${id++}` as WayId,
			version: 1,
			nodes: [...nodes, nodes[0] as NodeId],
			tags: { indoor: "room", level: "0" },
		});
	}
	return entities;
}

/** Median time of `runs` calls, in ms. */
function time(runs: number, fn: () => void): number {
	const times: number[] = [];
	for (let i = 0; i < runs; i++) {
		const start = performance.now();
		fn();
		times.push(performance.now() - start);
	}
	times.sort((a, b) => a - b);
	return times[Math.floor(times.length / 2)] as number;
}

const results: [string, number, string][] = [];
function report(name: string, ms: number, target: string) {
	results.push([name, ms, target]);
}

const entities = syntheticArea();
const graph = Graph.fromEntities(entities);
const presets = await loadPresetIndex();
const options = { icons: new Set<string>(), presets };
const ways = entities.filter((e) => e.type === "way");

report(
	"Full feature build",
	time(5, () => buildFeatures(graph, options)),
	"before P5.2",
);
report(
	"First build",
	time(5, () => new FeatureStore().update(graph, options)),
	"no slower than before",
);
const empty = Graph.fromEntities([]);
report(
	"Download into an empty editor",
	time(5, () => {
		const fresh = new FeatureStore();
		fresh.update(empty, options);
		fresh.update(empty.rebaseOnto(graph), options);
	}),
	"no slower than before",
);

const room = ways[5000] as Entity;
let n = 0;
report(
	"One tag edit → full rebuild",
	time(10, () => {
		const edited = changeTags(room.id, { ...room.tags, name: `Edit ${n++}` })(
			graph,
		);
		buildFeatures(edited, options);
	}),
	"before P5.2",
);

// As the editor does: the store updates, and the map is sent what changed.
const store = new FeatureStore();
const sent = new Map(store.update(graph, options).byId);
report(
	"One tag edit → map features",
	time(10, () => {
		const edited = changeTags(room.id, { ...room.tags, name: `Edit ${n++}` })(
			graph,
		);
		const { byId } = store.update(edited, options);
		const { add } = diffFeatures(sent, byId);
		for (const f of add) sent.set(f.properties["@id"], f);
	}),
	"< 16 ms",
);

const thousand = ways.slice(0, 1000).map((w) => w.id);
report(
	"Delete 1,000 rooms, one by one",
	time(3, () => deleteEntities(thousand)(graph)),
	"before P5.2",
);
// As History.perform runs actions: on one copy of the graph.
report(
	"Delete 1,000 rooms",
	time(3, () => graph.update(deleteEntities(thousand))),
	"< 150 ms",
);

const click: Loc = [2.35 + 50.5 * SIZE, 48.85 + 50.5 * SIZE];
const tolerance = SIZE * 0.2;
report(
	"Snap a click, walking every node",
	time(10, () => {
		let best: Loc | null = null;
		let bestDistance = tolerance;
		for (const entity of graph.entities()) {
			if (entity.type !== "node") continue;
			const d = Math.hypot(entity.loc[0] - click[0], entity.loc[1] - click[1]);
			if (d < bestDistance) {
				bestDistance = d;
				best = entity.loc;
			}
		}
		void best;
	}),
	"before P5.2",
);

const nodes = store.update(graph, options);
report(
	"Snap a click to a node",
	time(10, () => {
		nodes.nodesNear(
			{
				west: click[0] - tolerance,
				south: click[1] - tolerance,
				east: click[0] + tolerance,
				north: click[1] + tolerance,
			},
			0,
		);
	}),
	"< 1 ms",
);

// R1.12: the history after 10,000 local edits, each an undo step (every room renamed).
const heapBefore = process.memoryUsage().heapUsed;
const history = new History<string>(graph);
const editStart = performance.now();
for (const way of ways) {
	history.perform(
		changeTags(way.id, { ...way.tags, name: `${way.tags.name} edited` }),
		"Change tags",
	);
}
report(
	"10,000 edits, a step each",
	performance.now() - editStart,
	"for reference",
);
const heapMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
const scaled = new FeatureStore();
let shown = new Map(scaled.update(history.graph, options).byId);
let edit = 0;
report(
	"One more edit after 10,000",
	time(10, () => {
		const way = ways[edit++ % ways.length] as Entity;
		history.perform(
			changeTags(way.id, { ...way.tags, name: `Again ${edit}` }),
			"Change tags",
		);
		// What the editor does after each edit: the edit count, the map's features.
		history.graph.changeCount();
		const next = scaled.update(history.graph, options).byId;
		diffFeatures(shown, next);
		shown = new Map(next);
	}),
	"< 16 ms",
);

// R4.4: merging a downloaded tile (250 rooms) rebases every undo step onto it.
let nextTile = 10_000_000;
const freshTile = () => {
	const entities = tile(nextTile, 250);
	nextTile += 10_000;
	return entities;
};
const short = new History<string>(graph);
for (const way of ways.slice(0, 500)) {
	short.perform(
		changeTags(way.id, { ...way.tags, name: `${way.tags.name} edited` }),
		"Change tags",
	);
}
report(
	"Merge a tile under 500 steps",
	time(10, () => short.merge(freshTile())),
	"for reference",
);
report(
	"Merge a tile under 10,000 steps",
	time(5, () => history.merge(freshTile())),
	"for reference",
);
report(
	"changes() after 10,000 edits",
	time(10, () => history.graph.changes()),
	"Save dialog issues, for reference",
);

console.log(`${entities.length} entities, ${ways.length} rooms\n`);
console.log(`History of 10,000 steps holds about ${heapMb.toFixed(0)} MB\n`);
for (const [name, ms, target] of results) {
	console.log(
		`${name.padEnd(32)} ${ms.toFixed(1).padStart(8)} ms   (${target})`,
	);
}
