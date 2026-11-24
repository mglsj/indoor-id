import { describe, expect, it } from "vitest";
import { changeTags } from "#lib/actions/change-tags.ts";
import { type Bbox, OsmApiError } from "#lib/api/osm-api.ts";
import type { UploadedChanges } from "#lib/api/recent-uploads.ts";
import { msg } from "#lib/i18n/messages.ts";
import type { Entity } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { DataSync, type SyncApi } from "./data-sync.svelte.ts";
import { EditHistory } from "./edit-history.svelte.ts";
import { Selection } from "./selection.svelte.ts";

const VIEW: Bbox = { west: 2.349, south: 48.849, east: 2.351, north: 48.851 };

function setup(api: Partial<SyncApi> = {}) {
	const history = new EditHistory(Graph.fromEntities([]));
	const selection = new Selection();
	const sync = new DataSync({
		api: {
			loadMap: async () => [node("n1", { amenity: "bench" }, [2.35, 48.85])],
			loadRelation: async () => [],
			loadEntities: async () => [],
			upload: async () => {
				throw new Error("no upload");
			},
			...api,
		},
		minZoom: 16,
		history,
		selection,
		schedule: (run) => run(),
	});
	return { history, selection, sync };
}

describe("DataSync: downloads into the history, uploads from it", () => {
	it("downloads the view once zoomed in enough, reporting its status", async () => {
		const { history, sync } = setup();
		expect(sync.status).toEqual({ kind: "idle" });
		await sync.loadView(VIEW, 15);
		expect(sync.status).toEqual({ kind: "zoom-in" });
		const loading = sync.loadView(VIEW, 18);
		expect(sync.status).toEqual({ kind: "loading" });
		await loading;
		expect(sync.status).toEqual({ kind: "idle" });
		expect(history.graph.entity("n1")?.tags).toEqual({ amenity: "bench" });
	});

	it("downloads an area whatever the zoom, each tile once (a building entered)", async () => {
		const asked: Bbox[] = [];
		const { history, sync } = setup({
			loadMap: async (bbox) => {
				asked.push(bbox);
				return [node("n1", { amenity: "bench" }, [2.35, 48.85])];
			},
		});
		await sync.loadArea(VIEW);
		expect(sync.status).toEqual({ kind: "idle" });
		expect(history.graph.entity("n1")).toBeDefined();
		const tiles = asked.length;
		expect(tiles).toBeGreaterThan(0);
		await sync.loadView(VIEW, 18);
		expect(asked).toHaveLength(tiles);
	});

	it("reports areas that failed", async () => {
		const { sync } = setup({
			loadMap: () => Promise.reject(new Error("offline")),
		});
		await sync.loadView(VIEW, 18);
		expect(sync.status).toMatchObject({ kind: "error" });
	});

	it("downloads a relation's members", async () => {
		const members: Entity[] = [node("n7", { door: "yes" })];
		const { history, sync } = setup({ loadRelation: async () => members });
		await sync.loadRelation("r1");
		expect(history.graph.entity("n7")).toBeDefined();
	});

	it("starts again from the server's state after an upload, following new ids", async () => {
		const uploaded = Graph.fromEntities([node("n100", { amenity: "bench" })]);
		const { history, selection, sync } = setup({
			upload: async () => ({
				graph: uploaded,
				idMap: new Map([["n-1", "n100"]]),
				notDeleted: [],
				changesetId: 42,
			}),
		});
		history.perform(
			(graph) => graph.replace(node("n-1", {}, [0, 0])),
			msg("undo_change_tags"),
		);
		history.perform(
			changeTags("n-1", { amenity: "bench" }),
			msg("undo_change_tags"),
		);
		selection.select("n-1");
		expect(await sync.upload({ comment: "Benches" })).toEqual({
			kind: "uploaded",
			changesetId: 42,
			notDeleted: [],
		});
		expect(history.graph).toBe(uploaded);
		expect(history.canUndo).toBe(false);
		expect(selection.ids).toEqual(["n100"]);
	});

	it("says what an upload changed on the server", async () => {
		const history = new EditHistory(Graph.fromEntities([]));
		const changes: UploadedChanges[] = [];
		const sync = new DataSync({
			api: {
				loadMap: async () => [],
				loadRelation: async () => [],
				loadEntities: async () => [],
				upload: async () => ({
					graph: Graph.fromEntities([node("n100", { amenity: "bench" })]),
					idMap: new Map([["n-1", "n100"]]),
					notDeleted: [],
					changesetId: 42,
				}),
			},
			minZoom: 16,
			history,
			selection: new Selection(),
			onupload: (c) => changes.push(c),
		});
		history.perform(
			(graph) => graph.replace(node("n-1", { amenity: "bench" })),
			msg("undo_change_tags"),
		);
		await sync.upload({ comment: "Bench" });
		expect(changes).toEqual([
			{ written: [node("n100", { amenity: "bench" })], deleted: [] },
		]);
	});

	it("asks a retry to check the changeset of the upload that failed", async () => {
		const retries: (number | undefined)[] = [];
		const { history, sync } = setup({
			upload: async (_graph, _tags, options) => {
				retries.push(options?.retryOf);
				throw new OsmApiError("lost", "network", undefined, 41);
			},
		});
		history.perform(
			(graph) => graph.replace(node("n-1", {}, [0, 0])),
			msg("undo_add_point"),
		);

		await sync.upload({ comment: "One" }).catch(() => undefined);
		expect(sync.failedChangeset).toBe(41);
		await sync.upload({ comment: "One" }).catch(() => undefined);

		expect(retries).toEqual([undefined, 41]);
	});

	it("refuses broken edits before a changeset is opened (W3)", async () => {
		let uploads = 0;
		const { history, sync } = setup({
			upload: async () => {
				uploads++;
				throw new Error("should not upload");
			},
		});
		history.perform(
			(graph) =>
				graph
					.replace(node("n-1", {}, [0, 0]))
					.replace(node("n-2", {}, [0, 0.0001]))
					.replace(way("w-1", ["n-1", "n-2"], { level: "0" })),
			msg("undo_add_point"),
		);

		const refused = sync.upload({ comment: "Leftover" });

		await expect(refused).rejects.toThrow(
			"no changeset was opened, because OpenStreetMap would refuse or keep broken data: w-1 is a new line or area with no tags.",
		);
		expect(uploads).toBe(0);
		expect(sync.failedChangeset).toBeUndefined();
	});

	it("forgets the failed changeset once an upload goes through", async () => {
		const { history, sync } = setup({
			upload: async () => ({
				graph: Graph.fromEntities([]),
				idMap: new Map(),
				notDeleted: [],
				changesetId: 42,
			}),
		});
		sync.failedChangeset = 41;
		history.perform(
			(graph) => graph.replace(node("n-1", {}, [0, 0])),
			msg("undo_add_point"),
		);

		await sync.upload({ comment: "One" });

		expect(sync.failedChangeset).toBeUndefined();
	});

	it("drops the edits and downloads again, when the server already has them", async () => {
		let downloads = 0;
		const { history, sync } = setup({
			loadMap: async () => {
				downloads++;
				return [{ ...node("n1", { amenity: "toilets" }), version: 2 }];
			},
		});
		await sync.loadView(VIEW, 18);
		history.perform(
			changeTags("n1", { amenity: "toilets" }),
			msg("undo_change_tags"),
		);
		sync.failedChangeset = 41;

		sync.discard();
		await sync.loadView(VIEW, 18);

		expect(history.editCount).toBe(0);
		expect(history.canUndo).toBe(false);
		expect(sync.failedChangeset).toBeUndefined();
		expect(downloads).toBe(2);
		expect(history.graph.entity("n1")?.version).toBe(2);
	});

	it("holds edits and downloads while uploading, and downloads again what came before", async () => {
		let finish: (n: number) => void = () => {};
		const answers: ((entities: Entity[]) => void)[] = [];
		const uploaded = Graph.fromEntities([]);
		const { history, sync } = setup({
			loadMap: () => new Promise((resolve) => answers.push(resolve)),
			upload: () =>
				new Promise((resolve) => {
					finish = (changesetId) =>
						resolve({
							graph: uploaded,
							idMap: new Map(),
							notDeleted: [],
							changesetId,
						});
				}),
		});
		history.perform(
			(graph) => graph.replace(node("n-1", { amenity: "bench" }, [0, 0])),
			msg("undo_change_tags"),
		);

		const loading = sync.loadView(VIEW, 18);
		await Promise.resolve();
		const asked = answers.length;
		expect(asked).toBeGreaterThan(0);
		const uploading = sync.upload({ comment: "Bench" });
		expect(sync.uploading).toBe(true);
		expect(history.locked).toBe(true);
		history.undo();
		expect(history.graph.entity("n-1")).toBeDefined();
		// The upload is sent once the edits are checked against the server.
		await new Promise((r) => setTimeout(r, 0));

		// The server deleted n1 in the meantime: the answer asked for before is dropped.
		for (const answer of answers.splice(0))
			answer([node("n1", {}, [2.35, 48.85])]);
		finish(7);
		expect(await uploading).toMatchObject({ kind: "uploaded", changesetId: 7 });
		expect(history.locked).toBe(false);
		await new Promise((r) => setTimeout(r, 0));
		expect(history.graph.entity("n1")).toBeUndefined();

		// Its tiles are downloaded again, after the upload.
		expect(answers).toHaveLength(asked);
		for (const answer of answers.splice(0)) answer([]);
		await loading;
		expect(history.graph.entity("n1")).toBeUndefined();
	});

	it("keeps downloads that arrive during a failed upload", async () => {
		const answers: ((entities: Entity[]) => void)[] = [];
		let fail: () => void = () => {};
		const { history, sync } = setup({
			loadMap: () => new Promise((resolve) => answers.push(resolve)),
			upload: () =>
				new Promise((_, reject) => {
					fail = () => reject(new Error("offline"));
				}),
		});
		const loading = sync.loadView(VIEW, 18);
		await Promise.resolve();
		const uploading = sync.upload({ comment: "Bench" });
		for (const answer of answers.splice(0))
			answer([node("n1", {}, [2.35, 48.85])]);
		await loading;
		expect(history.graph.entity("n1")).toBeUndefined();
		fail();
		await expect(uploading).rejects.toThrow("offline");
		expect(history.graph.entity("n1")).toBeDefined();
	});

	it("refuses to upload more changes than a changeset takes", async () => {
		let uploads = 0;
		const { history, sync } = setup({
			upload: async () => {
				uploads++;
				throw new Error("sent");
			},
		});
		history.perform((graph) => {
			for (let i = 1; i <= 10_001; i++)
				graph.replace(node(`n${-i}`, { amenity: "bench" }, [0, 0]));
			return graph;
		}, msg("undo_change_tags"));
		expect(history.editCount).toBe(10_001);
		await expect(sync.upload({ comment: "Benches" })).rejects.toThrow(
			"10001 features changed: a changeset takes at most 10000",
		);
		expect(uploads).toBe(0);
		expect(history.locked).toBe(false);
	});

	it("merges their changes before uploading, as an undo step", async () => {
		const sent: Graph[] = [];
		const { history, sync } = setup({
			loadEntities: async () => [
				{
					id: "n1",
					version: 2,
					entity: {
						...node("n1", { amenity: "bench", colour: "red" }, [2.35, 48.85]),
						version: 2,
					},
				},
			],
			upload: async (graph) => {
				sent.push(graph);
				throw new Error("offline");
			},
		});
		history.merge([node("n1", { amenity: "bench" }, [2.35, 48.85])]);
		history.perform(
			changeTags("n1", { amenity: "bench", backrest: "yes" }),
			msg("undo_change_tags"),
		);
		await expect(sync.upload({ comment: "Bench" })).rejects.toThrow("offline");
		expect(sent[0]?.entity("n1")).toMatchObject({
			version: 2,
			tags: { amenity: "bench", backrest: "yes", colour: "red" },
		});
		// The merge is a step: undone, the edit is as made.
		history.undo();
		expect(history.graph.entity("n1")?.tags).toEqual({
			amenity: "bench",
			backrest: "yes",
		});
	});

	it("uploads nothing while edits clash, until each is resolved", async () => {
		let uploads = 0;
		const { history, sync } = setup({
			loadEntities: async () => [
				{
					id: "n1",
					version: 2,
					user: "Ana",
					entity: {
						...node("n1", { amenity: "chair" }, [2.35, 48.85]),
						version: 2,
					},
				},
			],
			upload: async (graph) => {
				uploads++;
				return {
					graph: graph.base(),
					idMap: new Map(),
					notDeleted: [],
					changesetId: 9,
				};
			},
		});
		history.merge([node("n1", { amenity: "bench" }, [2.35, 48.85])]);
		history.perform(
			changeTags("n1", { amenity: "table" }),
			msg("undo_change_tags"),
		);

		const outcome = await sync.upload({ comment: "Bench" });
		expect(outcome.kind).toBe("conflicts");
		expect(sync.conflicts.map((c) => [c.id, c.kind, c.keys])).toEqual([
			["n1", "both-edited", ["amenity"]],
		]);
		expect(uploads).toBe(0);
		expect(history.locked).toBe(false);

		await sync.resolve("n1", "mine");
		expect(sync.conflicts).toEqual([]);
		expect(history.graph.entity("n1")).toMatchObject({
			version: 2,
			tags: { amenity: "table" },
		});
		expect(await sync.upload({ comment: "Bench" })).toMatchObject({
			kind: "uploaded",
			changesetId: 9,
		});
		expect(uploads).toBe(1);
	});

	it("says when their changes leave nothing to upload", async () => {
		const { history, sync } = setup({
			loadEntities: async () => [{ id: "n1", version: 2, entity: null }],
		});
		history.merge([node("n1", { amenity: "bench" }, [2.35, 48.85])]);
		history.perform((g) => g.remove("n1"), msg("undo_change_tags"));
		expect(await sync.upload({ comment: "Bench" })).toEqual({
			kind: "up-to-date",
		});
		expect(history.editCount).toBe(0);
	});

	it("downloads the nodes their version of a way uses", async () => {
		const asked: string[][] = [];
		const { history, sync } = setup({
			loadEntities: async (ids) => {
				asked.push([...ids]);
				if (ids.includes("w1")) {
					return [
						{
							id: "w1",
							version: 2,
							entity: {
								...way("w1", ["n1", "n2"], { highway: "corridor" }),
								version: 2,
							},
						},
					];
				}
				return [
					{ id: "n2", version: 1, entity: node("n2", {}, [2.351, 48.85]) },
				];
			},
		});
		history.merge([
			node("n1", {}, [2.35, 48.85]),
			way("w1", ["n1"], { highway: "corridor" }),
		]);
		history.perform(
			changeTags("w1", { highway: "corridor", level: "0" }),
			msg("undo_change_tags"),
		);
		await sync.upload({ comment: "Level" }).catch(() => undefined);
		expect(asked).toEqual([["w1", "n1"], ["n2"]]);
		expect(history.graph.entity("w1")).toMatchObject({ nodes: ["n1", "n2"] });
		expect(history.graph.entity("n2")).toBeDefined();
	});
});
