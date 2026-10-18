import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import type { Entity } from "#lib/osm/entity.ts";
import { node } from "#lib/osm/fixtures.ts";
import { Catalog } from "#lib/state/catalog.svelte.ts";
import { Editor } from "#lib/state/editor.svelte.ts";
import FieldsSection from "./FieldsSection.svelte";
import { renderWithEditor } from "./testing/render.ts";

/** An editor holding two benches, one with a backrest. */
async function benches() {
	const catalog = new Catalog({
		storage: { getItem: () => null, setItem: () => {} },
	});
	await catalog.loaded;
	const editor = new Editor({
		api: {
			loadMap: async () => [],
			loadRelation: async () => [],
			upload: () => Promise.reject(new Error("no upload")),
		},
		minZoom: 16,
		catalog,
	});
	editor.history.merge([
		node("n1", { amenity: "bench", backrest: "yes" }, [2.35, 48.85]),
		node("n2", { amenity: "bench" }, [2.35, 48.85]),
	]);
	const entities = (["n1", "n2"] as const).map(
		(id) => editor.graph.entity(id) as Entity,
	);
	const preset = editor.presetOf(entities[0] as Entity);
	if (!preset) throw new Error("no bench preset");
	return { editor, entities, preset };
}

describe("FieldsSection over several features", () => {
	it("changes every feature in one undo step", async () => {
		const { editor, entities, preset } = await benches();
		renderWithEditor(editor, FieldsSection, { entities, preset });
		const backrest = page.getByRole("checkbox", { name: "Backrest" });
		await expect.element(backrest).toHaveAttribute("aria-checked", "mixed");
		await backrest.click();
		expect(editor.graph.entity("n1")?.tags.backrest).toBe("yes");
		expect(editor.graph.entity("n2")?.tags.backrest).toBe("yes");
		editor.history.undo();
		expect(editor.graph.entity("n2")?.tags.backrest).toBeUndefined();
		expect(editor.history.canUndo).toBe(false);
	});

	it("only shows them when read-only: inputs disabled, no buttons", async () => {
		const { editor, entities, preset } = await benches();
		renderWithEditor(editor, FieldsSection, {
			entities: entities.slice(0, 1),
			preset,
			readonly: true,
		});
		await expect
			.element(page.getByRole("checkbox", { name: "Backrest" }))
			.toBeDisabled();
		expect(page.getByRole("button", { name: /^Remove / }).elements()).toEqual(
			[],
		);
		expect(page.getByRole("button", { name: "Add field" }).elements()).toEqual(
			[],
		);
	});
});
