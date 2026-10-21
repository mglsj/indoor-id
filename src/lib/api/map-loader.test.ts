import { describe, expect, it } from "vitest";
import { tileBounds } from "#lib/map/tiles.ts";
import type { Entity } from "#lib/osm/entity.ts";
import { node } from "#lib/osm/fixtures.ts";
import { MapLoader } from "./map-loader.ts";
import type { Bbox } from "./osm-api.ts";

/** A download function whose calls are recorded and resolved by the test. */
function controlledDownload() {
	const calls: {
		bbox: Bbox;
		resolve: (e: Entity[]) => void;
		reject: (e: Error) => void;
	}[] = [];
	let inFlight = 0;
	let maxInFlight = 0;
	const download = (bbox: Bbox) =>
		new Promise<Entity[]>((resolve, reject) => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			let settled = false;
			const done = () => {
				if (!settled) inFlight--;
				settled = true;
			};
			calls.push({
				bbox,
				resolve: (e) => {
					done();
					resolve(e);
				},
				reject: (e) => {
					done();
					reject(e);
				},
			});
		});
	return { download, calls, maxInFlight: () => maxInFlight };
}

/** Lets pending promise callbacks run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** An area covering tiles x0..x1, y0..y1 at zoom 16. */
function area(x0: number, y0: number, x1 = x0, y1 = y0): Bbox {
	const nw = tileBounds({ x: x0, y: y0, z: 16 });
	const se = tileBounds({ x: x1, y: y1, z: 16 });
	return { west: nw.west, north: nw.north, east: se.east, south: se.south };
}

describe("MapLoader", () => {
	it("downloads each tile of the area and hands over its entities", async () => {
		const { download, calls } = controlledDownload();
		const received: Entity[] = [];
		const loader = new MapLoader({
			download,
			onData: (e) => received.push(...e),
		});

		const loading = loader.load(area(100, 200, 101, 200));
		await flush();
		expect(calls.map((c) => c.bbox)).toEqual([area(100, 200), area(101, 200)]);
		calls[0]?.resolve([node("n1")]);
		calls[1]?.resolve([node("n2")]);

		await expect(loading).resolves.toEqual({ failed: 0, skipped: false });
		expect(received.map((e) => e.id)).toEqual(["n1", "n2"]);
	});

	it("doesn't download a tile twice", async () => {
		const { download, calls } = controlledDownload();
		const loader = new MapLoader({ download, onData: () => {} });

		const first = loader.load(area(100, 200));
		const overlapping = loader.load(area(100, 200, 101, 200));
		await flush();
		for (const call of calls) call.resolve([]);
		await Promise.all([first, overlapping]);
		await loader.load(area(100, 200, 101, 200));

		expect(calls.map((c) => c.bbox)).toEqual([area(100, 200), area(101, 200)]);
	});

	it("downloads at most 4 tiles at a time", async () => {
		const { download, calls, maxInFlight } = controlledDownload();
		const loader = new MapLoader({ download, onData: () => {} });

		const loading = loader.load(area(100, 200, 102, 201));
		for (let i = 0; i < 6; i++) {
			await flush();
			for (const call of calls) call.resolve([]);
		}
		await loading;

		expect(calls).toHaveLength(6);
		expect(maxInFlight()).toBe(4);
	});

	it("retries failed tiles on a later load", async () => {
		const { download, calls } = controlledDownload();
		let time = 0;
		const loader = new MapLoader({
			download,
			onData: () => {},
			now: () => time,
		});

		const loading = loader.load(area(100, 200));
		await flush();
		calls[0]?.reject(new Error("HTTP 509"));
		await expect(loading).resolves.toEqual({ failed: 1, skipped: false });

		time = 1000;
		const retry = loader.load(area(100, 200));
		await flush();
		expect(calls).toHaveLength(2);
		calls[1]?.resolve([]);
		await expect(retry).resolves.toEqual({ failed: 0, skipped: false });
	});

	it("skips areas needing too many tiles (zoomed out too far)", async () => {
		const { download, calls } = controlledDownload();
		const loader = new MapLoader({ download, onData: () => {}, maxTiles: 4 });

		await expect(loader.load(area(100, 200, 102, 201))).resolves.toEqual({
			failed: 0,
			skipped: true,
		});
		expect(calls).toEqual([]);
	});

	it("hands over tiles arriving in the same frame as one batch", async () => {
		const { download, calls } = controlledDownload();
		const batches: string[][] = [];
		const frames: (() => void)[] = [];
		const loader = new MapLoader({
			download,
			onData: (e) => batches.push(e.map((x) => x.id)),
			schedule: (run) => frames.push(run),
		});

		const loading = loader.load(area(100, 200, 102, 200));
		await flush();
		calls[0]?.resolve([node("n1")]);
		calls[1]?.resolve([node("n2")]);
		await flush();
		// Nothing until the frame: one frame is asked for, however many tiles arrived.
		expect(batches).toEqual([]);
		expect(frames).toHaveLength(1);
		frames.shift()?.();
		expect(batches).toEqual([["n1", "n2"]]);

		// A tile arriving later goes in the next batch.
		calls[2]?.resolve([node("n3")]);
		await loading;
		expect(batches).toEqual([["n1", "n2"], ["n3"]]);
	});

	it("hands everything over before the load resolves, even if no frame came", async () => {
		const { download, calls } = controlledDownload();
		const batches: string[][] = [];
		const loader = new MapLoader({
			download,
			onData: (e) => batches.push(e.map((x) => x.id)),
			schedule: () => {},
		});

		const loading = loader.load(area(100, 200, 101, 200));
		await flush();
		calls[0]?.resolve([node("n1")]);
		calls[1]?.resolve([node("n2")]);
		await loading;

		expect(batches).toEqual([["n1", "n2"]]);
	});

	it("keeps its defaults for options passed as undefined", async () => {
		const { download, calls, maxInFlight } = controlledDownload();
		const loader = new MapLoader({
			download,
			onData: () => {},
			concurrency: undefined,
			schedule: undefined,
		});

		const loading = loader.load(area(100, 200, 102, 201));
		for (let i = 0; i < 6; i++) {
			await flush();
			for (const call of calls) call.resolve([]);
		}
		await loading;

		expect(maxInFlight()).toBe(4);
	});

	describe("paused (while uploading)", () => {
		it("starts no download and hands nothing over until resumed", async () => {
			const { download, calls } = controlledDownload();
			const received: string[] = [];
			const loader = new MapLoader({
				download,
				onData: (e) => received.push(...e.map((x) => x.id)),
				schedule: (run) => run(),
			});

			const before = loader.load(area(100, 200));
			await flush();
			loader.pause();
			const during = loader.load(area(101, 200));
			await flush();
			expect(calls).toHaveLength(1);
			calls[0]?.resolve([node("n1")]);
			await before;
			expect(received).toEqual([]);

			loader.resume();
			expect(received).toEqual(["n1"]);
			await flush();
			expect(calls).toHaveLength(2);
			calls[1]?.resolve([node("n2")]);
			await during;
			expect(received).toEqual(["n1", "n2"]);
		});

		it("drops answers from before a reset and downloads their tiles again", async () => {
			const { download, calls } = controlledDownload();
			const received: string[] = [];
			const loader = new MapLoader({
				download,
				onData: (e) => received.push(...e.map((x) => x.id)),
				schedule: (run) => run(),
			});

			// One tile answered while paused, one still on its way when the reset comes.
			const loading = loader.load(area(100, 200, 101, 200));
			await flush();
			loader.pause();
			calls[0]?.resolve([node("n1", { deleted: "on the server" })]);
			await flush();
			loader.reset();
			loader.resume();
			calls[1]?.resolve([node("n2", { deleted: "on the server" })]);
			await flush();
			expect(received).toEqual([]);

			// The tile in flight is downloaded again at once, the other one on the next load.
			expect(calls).toHaveLength(3);
			expect(calls[2]?.bbox).toEqual(area(101, 200));
			calls[2]?.resolve([node("n2")]);
			await expect(loading).resolves.toEqual({ failed: 0, skipped: false });
			expect(received).toEqual(["n2"]);

			const again = loader.load(area(100, 200, 101, 200));
			await flush();
			expect(calls.map((c) => c.bbox).slice(3)).toEqual([area(100, 200)]);
			calls[3]?.resolve([node("n1")]);
			await again;
			expect(received).toEqual(["n2", "n1"]);
		});
	});

	it("downloads a tile with too much data as its four quarters, from then on", async () => {
		const { download, calls } = controlledDownload();
		const loader = new MapLoader({ download, onData: () => {} });
		const tooMany = Object.assign(new Error("too many nodes"), { status: 400 });

		const loading = loader.load(area(100, 200));
		await flush();
		calls[0]?.reject(tooMany);
		await flush();
		const quarter = (x: number, y: number) => tileBounds({ x, y, z: 17 });
		expect(calls.slice(1).map((c) => c.bbox)).toEqual([
			quarter(200, 400),
			quarter(201, 400),
			quarter(200, 401),
			quarter(201, 401),
		]);
		for (const call of calls.slice(1)) call.resolve([]);
		await expect(loading).resolves.toEqual({ failed: 0, skipped: false });

		// Loaded: nothing downloaded again, the whole tile least of all.
		await loader.load(area(100, 200));
		expect(calls).toHaveLength(5);
	});

	it("waits longer after each failure before downloading a tile again", async () => {
		const { download, calls } = controlledDownload();
		let time = 0;
		const loader = new MapLoader({
			download,
			onData: () => {},
			now: () => time,
		});
		const fail = async () => {
			const loading = loader.load(area(100, 200));
			await flush();
			calls.at(-1)?.reject(new Error("HTTP 509"));
			return loading;
		};

		await fail();
		// A move right after: not asked again, still reported as failed.
		await expect(loader.load(area(100, 200))).resolves.toEqual({
			failed: 1,
			skipped: false,
		});
		expect(calls).toHaveLength(1);
		time = 1000;
		await fail();
		expect(calls).toHaveLength(2);
		// 2 s after the second failure.
		time = 2999;
		await loader.load(area(100, 200));
		expect(calls).toHaveLength(2);
		time = 3000;
		const retry = loader.load(area(100, 200));
		await flush();
		calls[2]?.resolve([]);
		await expect(retry).resolves.toEqual({ failed: 0, skipped: false });
	});
});
