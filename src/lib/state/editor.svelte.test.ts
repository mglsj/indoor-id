import { describe, expect, it } from "vitest";
import { OPERATIONS } from "#lib/edit/operations.ts";
import type { Entity } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import type { PresetIndex } from "#lib/presets/presets.ts";
import { Catalog } from "./catalog.svelte.ts";
import {
	addToRelation,
	fix,
	moveMember,
	performEdit,
	relationLabel,
} from "./commands.ts";
import { Editor } from "./editor.svelte.ts";

const NO_STORAGE = { getItem: () => null, setItem: () => {} };

/** An editor holding `entities`, with local upgrades only and no presets. */
function editorWith(entities: Entity[]) {
	const editor = new Editor({
		api: {
			loadMap: async () => [],
			loadRelation: async () => [],
			upload: async () => {
				throw new Error("no upload");
			},
		},
		minZoom: 16,
		catalog: new Catalog({
			storage: NO_STORAGE,
			load: {
				presets: () => new Promise<PresetIndex>(() => {}),
				upgrades: async () => [],
				discardedKeys: async () => [],
			},
		}),
	});
	editor.history.merge(entities);
	return editor;
}

const benches = () =>
	editorWith([
		node("n1", { amenity: "bench", name: "Old" }),
		node("n2", { amenity: "bench" }),
	]);

describe("Editor", () => {
	it("edits one feature in the Inspector, when a single one is selected", () => {
		const editor = benches();
		expect(editor.selected).toBeNull();
		editor.select("n1");
		expect(editor.selected?.id).toBe("n1");
		editor.select(["n1", "n2"]);
		expect(editor.selected).toBeNull();
	});

	it("ends the typing step when another feature is selected", () => {
		const editor = benches();
		editor.select("n1");
		editor.history.setTags("n1", { name: "A" }, { live: true });
		editor.select("n2");
		editor.select("n1");
		editor.history.setTags("n1", { name: "AB" }, { live: true });
		editor.history.undo();
		expect(editor.graph.entity("n1")?.tags).toEqual({ name: "A" });
	});

	it("gives the issues of a feature and of the edits, with their fixes", () => {
		const editor = editorWith([
			node("n1", { door: "yes" }),
			node("n2", { room: "stairs", indoor: "room", level: "0" }),
		]);
		expect(editor.issuesOf("n1").map((i) => i.rule)).toEqual([
			"door-not-on-wall",
		]);
		// Nothing edited yet.
		expect(editor.editIssues).toEqual([]);
		const [outdated] = editor.issuesOf("n2");
		if (!outdated) throw new Error("no issue");
		fix(editor, outdated);
		expect(editor.issuesOf("n2")).toEqual([]);
		expect(editor.history.editCount).toBe(1);
	});
});

describe("commands", () => {
	const roomAndDoor = () =>
		editorWith([
			node("n1", { door: "yes" }),
			node("n2"),
			way("w1", ["n1", "n2"], { indoor: "wall" }),
		]);

	it("adds a feature to a new relation, then to that one, in steps of their own", () => {
		const editor = roomAndDoor();
		const created = addToRelation(editor, "w1", null, "outer");
		expect(addToRelation(editor, "n1", created, "entrance")).toBe(created);
		const relation = editor.graph.entity(created);
		expect(relation?.type === "relation" && relation.members).toEqual([
			{ ref: "w1", role: "outer" },
			{ ref: "n1", role: "entrance" },
		]);
		expect(relationLabel(editor, relation as never)).toBe("Relation ");
		// A member moved onto itself makes no step.
		moveMember(editor, created, 0, 0);
		editor.history.undo();
		editor.history.undo();
		expect(editor.graph.entity(created)).toBeUndefined();
	});

	it("deletes the selection in one step, selecting nothing after", () => {
		const editor = roomAndDoor();
		editor.select(["w1", "n1"]);
		const remove = OPERATIONS.find((o) => o.id === "delete");
		const result = remove?.run({
			graph: editor.graph,
			selected: editor.selection.ids,
			level: 0,
			pasteAt: [0, 0],
			clipboard: null,
		});
		if (result?.kind !== "edit") throw new Error("not an edit");
		performEdit(editor, result);
		expect(editor.graph.entity("w1")).toBeUndefined();
		expect(editor.selection.ids).toEqual([]);
		editor.history.undo();
		expect(editor.graph.entity("w1")).toBeDefined();
		expect(editor.graph.entity("n1")).toBeDefined();
	});
});
