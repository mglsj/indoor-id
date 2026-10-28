import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { changeTags } from "#lib/actions/change-tags.ts";
import { msg } from "#lib/i18n/messages.ts";
import { node } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { Catalog } from "#lib/state/catalog.svelte.ts";
import type { SyncApi } from "#lib/state/data-sync.svelte.ts";
import { Editor } from "#lib/state/editor.svelte.ts";
import type { LoginOptions, Session } from "#lib/state/session.svelte.ts";
import SaveDialog from "./SaveDialog.svelte";
import { renderWithEditor } from "./testing/render.ts";

/** An editor with one bench edited, uploading through `upload`. */
async function editedBench(upload: SyncApi["upload"]) {
	const catalog = new Catalog({
		storage: { getItem: () => null, setItem: () => {} },
	});
	await catalog.loaded;
	const editor = new Editor({
		api: { loadMap: async () => [], loadRelation: async () => [], upload },
		minZoom: 16,
		catalog,
	});
	editor.history.merge([node("n1", { amenity: "bench" }, [2.35, 48.85])]);
	editor.history.perform(
		changeTags("n1", { amenity: "bench", backrest: "yes" }),
		msg("undo_change_tags"),
	);
	return editor;
}

function session(loggedIn: boolean, login = vi.fn(async () => {})) {
	return {
		configured: true,
		loggedIn,
		userName: null,
		login,
		logout: vi.fn(),
	} as unknown as Session;
}

const props = (s: Session) => ({
	session: s,
	imagery: [],
	websiteUrl: "https://osm.example",
	onclose: () => {},
});

describe("SaveDialog", () => {
	it("lists the deletions the server kept after uploading", async () => {
		const editor = await editedBench(async () => ({
			graph: Graph.fromEntities([]),
			idMap: new Map(),
			notDeleted: ["w5", "n7"],
			changesetId: 42,
		}));
		renderWithEditor(editor, SaveDialog, props(session(true)));
		await page.getByRole("textbox", { name: "Comment" }).fill("Benches");
		await page.getByRole("button", { name: "Upload" }).click();
		await expect
			.element(page.getByRole("link", { name: "changeset 42" }))
			.toBeVisible();
		const note = page.getByRole("note", { name: "Deletions kept" });
		await expect.element(note).toBeVisible();
		expect(note.element().textContent).toContain(
			"kept 2 of the features you deleted, because other data still uses them: w5, n7",
		);
	});

	it("tags shown floor plans as custom imagery, and says when it uploaded", async () => {
		const upload = vi.fn<SyncApi["upload"]>(async () => ({
			graph: Graph.fromEntities([]),
			idMap: new Map(),
			notDeleted: [],
			changesetId: 7,
		}));
		const onuploaded = vi.fn();
		renderWithEditor(await editedBench(upload), SaveDialog, {
			...props(session(true)),
			floorPlans: true,
			onuploaded,
		});
		await page.getByRole("textbox", { name: "Comment" }).fill("Rooms");
		await page.getByRole("button", { name: "Upload" }).click();
		await expect
			.element(page.getByRole("link", { name: "changeset 7" }))
			.toBeVisible();
		expect(upload.mock.calls[0]?.[1]).toMatchObject({
			imagery_used: "Custom",
			source: "custom imagery",
		});
		expect(onuploaded).toHaveBeenCalledOnce();
	});

	it("can be cancelled while logging in", async () => {
		let signal: AbortSignal | undefined;
		const login = vi.fn(
			(options: LoginOptions = {}) =>
				new Promise<void>((_, reject) => {
					signal = options.signal;
					signal?.addEventListener("abort", () =>
						reject(new Error("Login cancelled.")),
					);
				}),
		);
		const upload = vi.fn(() => Promise.reject(new Error("not sent")));
		const editor = await editedBench(upload);
		renderWithEditor(editor, SaveDialog, props(session(false, login)));
		await page.getByRole("textbox", { name: "Comment" }).fill("Benches");
		await page.getByRole("button", { name: "Upload" }).click();
		await expect
			.element(page.getByRole("button", { name: /Logging in/ }))
			.toBeDisabled();
		await page.getByRole("button", { name: "Cancel" }).click();
		expect(signal?.aborted).toBe(true);
		await expect
			.element(page.getByRole("button", { name: "Upload" }))
			.toBeEnabled();
		expect(upload).not.toHaveBeenCalled();
		expect(page.getByRole("alert").elements()).toHaveLength(0);
	});
});
