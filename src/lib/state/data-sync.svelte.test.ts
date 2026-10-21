import { describe, expect, it } from "vitest";
import { changeTags } from "#lib/actions/change-tags.ts";
import type { Bbox } from "#lib/api/osm-api.ts";
import { msg } from "#lib/i18n/messages.ts";
import type { Entity } from "#lib/osm/entity.ts";
import { node } from "#lib/osm/fixtures.ts";
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
		expect(await sync.upload({ comment: "Benches" })).toBe(42);
		expect(history.graph).toBe(uploaded);
		expect(history.canUndo).toBe(false);
		expect(selection.ids).toEqual(["n100"]);
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

		// The server deleted n1 in the meantime: the answer asked for before is dropped.
		for (const answer of answers.splice(0))
			answer([node("n1", {}, [2.35, 48.85])]);
		finish(7);
		expect(await uploading).toBe(7);
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
});
