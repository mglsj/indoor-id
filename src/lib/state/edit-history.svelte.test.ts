import { describe, expect, it } from "vitest";
import { changeTags } from "#lib/actions/change-tags.ts";
import { moveNode } from "#lib/actions/geometry.ts";
import { msg } from "#lib/i18n/messages.ts";
import type { EntityId } from "#lib/osm/entity.ts";
import { node } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { EditHistory } from "./edit-history.svelte.ts";

/** Two benches, as downloaded. */
const benches = () =>
	new EditHistory(
		Graph.fromEntities([
			node("n1", { amenity: "bench", name: "Old" }, [2.35, 48.85]),
			node("n2", { amenity: "bench" }, [2.35, 48.85]),
		]),
	);

const tagsOf = (history: EditHistory, id: EntityId) =>
	history.graph.entity(id)?.tags;

/** Undoes every step, returning how many there were. */
function undoAll(history: EditHistory): number {
	let steps = 0;
	while (history.canUndo) {
		history.undo();
		steps++;
	}
	return steps;
}

describe("EditHistory.setTags: one undo step per field edit, as iD's entity editor", () => {
	it("folds the changes made while typing into one step, which leaving the field closes", () => {
		const history = benches();
		history.setTags("n1", { amenity: "bench", name: "N" }, { live: true });
		history.setTags("n1", { amenity: "bench", name: "New " }, { live: true });
		// Kept as typed while typing.
		expect(tagsOf(history, "n1")?.name).toBe("New ");
		history.setTags("n1", { amenity: "bench", name: "New " });
		expect(tagsOf(history, "n1")?.name).toBe("New");

		// Another edit afterwards is a step of its own.
		history.setTags("n1", { amenity: "bench", name: "Newer" }, { live: true });
		history.setTags("n1", { amenity: "bench", name: "Newer" });
		expect(undoAll(history)).toBe(2);
		expect(tagsOf(history, "n1")?.name).toBe("Old");
	});

	it("makes no step for tags left as they were", () => {
		const history = benches();
		history.setTags("n1", { amenity: "bench", name: " Old " });
		expect(history.canUndo).toBe(false);
	});

	it("closes the step when leaving the field changed nothing more", () => {
		const history = benches();
		history.setTags("n1", { amenity: "bench", name: "New" }, { live: true });
		history.setTags("n1", { amenity: "bench", name: "New" });
		history.setTags("n1", { amenity: "bench", name: "Newer" }, { live: true });
		expect(undoAll(history)).toBe(2);
	});

	it("starts a new step for another feature, after another edit, or once typing ends", () => {
		const history = benches();
		history.setTags("n1", { amenity: "bench", name: "A" }, { live: true });
		history.setTags("n2", { amenity: "bench", name: "B" }, { live: true });
		// Another kind of edit (changing the type, a relation, a fix…).
		history.perform(
			changeTags("n2", { amenity: "toilets" }),
			msg("undo_change_tags"),
		);
		history.setTags("n2", { amenity: "toilets", name: "C" }, { live: true });
		// Another feature selected.
		history.endTyping();
		history.setTags("n2", { amenity: "toilets", name: "CD" }, { live: true });
		expect(undoAll(history)).toBe(5);
		expect(tagsOf(history, "n1")).toEqual({ amenity: "bench", name: "Old" });
	});

	it("starts a new step after an undo, leaving the undone edit to redo", () => {
		const history = benches();
		history.setTags("n1", { amenity: "bench", name: "A" });
		history.setTags("n1", { amenity: "bench", name: "AB" }, { live: true });
		history.undo();
		history.setTags("n1", { amenity: "bench", name: "AC" }, { live: true });
		expect(tagsOf(history, "n1")?.name).toBe("AC");
		history.undo();
		expect(tagsOf(history, "n1")?.name).toBe("A");
	});
});

describe("EditHistory", () => {
	it("counts the features changed since the download, and keeps their downloaded tags", () => {
		const history = benches();
		expect(history.editCount).toBe(0);
		history.perform(
			changeTags("n1", { amenity: "bench" }),
			msg("undo_change_tags"),
		);
		history.perform(
			changeTags("n2", { amenity: "toilets" }),
			msg("undo_change_tags"),
		);
		expect(history.editCount).toBe(2);
		expect(history.downloadedTags("n1")).toEqual({
			amenity: "bench",
			name: "Old",
		});
		expect(history.downloadedTags("n-1")).toBeUndefined();
		history.undo();
		expect(history.editCount).toBe(1);
		expect(history.canRedo).toBe(true);
	});

	it("amends the last step only while the graph is still the one it made", () => {
		const history = benches();
		history.perform(
			changeTags("n1", { wikidata: "Q1" }),
			msg("undo_change_tags"),
		);
		const after = history.graph;
		history.amend(after, "n1", (tags) => ({ ...tags, wikipedia: "en:One" }));
		expect(tagsOf(history, "n1")).toEqual({
			wikidata: "Q1",
			wikipedia: "en:One",
		});
		expect(undoAll(history)).toBe(1);

		// Something done since wins.
		history.perform(
			changeTags("n1", { wikidata: "Q2" }),
			msg("undo_change_tags"),
		);
		const stale = history.graph;
		history.perform(
			changeTags("n1", { name: "Other" }),
			msg("undo_change_tags"),
		);
		history.amend(stale, "n1", (tags) => ({ ...tags, wikipedia: "en:Two" }));
		expect(tagsOf(history, "n1")).toEqual({ name: "Other" });
	});

	it("amends the last step after downloaded data was merged under it", () => {
		const history = benches();
		history.perform(
			changeTags("n1", { wikidata: "Q1" }),
			msg("undo_change_tags"),
		);
		const after = history.graph;
		history.merge([node("n3", { amenity: "toilets" }, [2.35, 48.85])]);
		history.amend(after, "n1", (tags) => ({ ...tags, wikipedia: "en:One" }));
		expect(tagsOf(history, "n1")).toEqual({
			wikidata: "Q1",
			wikipedia: "en:One",
		});
		expect(tagsOf(history, "n3")).toEqual({ amenity: "toilets" });
	});

	it("refuses edits, undo and redo while locked (uploading)", () => {
		const history = benches();
		history.perform(
			changeTags("n1", { amenity: "bench" }),
			msg("undo_change_tags"),
		);
		const after = history.graph;
		history.lock();
		expect(history.locked).toBe(true);
		history.undo();
		history.perform(changeTags("n2", {}), msg("undo_change_tags"));
		history.setTags("n2", { amenity: "table" });
		history.patchTags(["n2"], { name: "X" });
		history.amend(after, "n1", () => ({ name: "Y" }));
		expect(history.graph).toBe(after);
		expect(tagsOf(history, "n1")).toEqual({ amenity: "bench" });

		history.unlock();
		history.undo();
		expect(tagsOf(history, "n1")).toEqual({ amenity: "bench", name: "Old" });
	});

	it("takes downloaded data under the edits, and starts again from an uploaded graph", () => {
		const history = benches();
		history.perform(
			changeTags("n1", { amenity: "bench" }),
			msg("undo_change_tags"),
		);
		history.merge([node("n3", { amenity: "toilets" }, [2.35, 48.85])]);
		expect(tagsOf(history, "n3")).toEqual({ amenity: "toilets" });
		expect(tagsOf(history, "n1")).toEqual({ amenity: "bench" });
		expect(history.editCount).toBe(1);

		history.reset(Graph.fromEntities([node("n1", { amenity: "bench" })]));
		expect(history.editCount).toBe(0);
		expect(history.canUndo).toBe(false);
		expect(tagsOf(history, "n2")).toBeUndefined();
	});
});

describe("EditHistory.patchTags: a field's change over every selected feature", () => {
	it("changes each feature in one undo step, keeping their other tags", () => {
		const history = benches();
		history.patchTags(["n1", "n2"], { backrest: "yes", name: undefined });
		expect(tagsOf(history, "n1")).toEqual({
			amenity: "bench",
			backrest: "yes",
		});
		expect(tagsOf(history, "n2")).toEqual({
			amenity: "bench",
			backrest: "yes",
		});
		expect(undoAll(history)).toBe(1);
	});

	it("takes a patch made from each feature's own tags", () => {
		const history = benches();
		history.patchTags(["n1", "n2"], (tags) => ({
			description: tags.name ? `Named ${tags.name}` : "Unnamed",
		}));
		expect(tagsOf(history, "n1")?.description).toBe("Named Old");
		expect(tagsOf(history, "n2")?.description).toBe("Unnamed");
	});

	it("tells a patch made per feature which feature it is for", () => {
		const history = benches();
		history.patchTags(["n1", "n2"], (_, id) => ({ ref: id }));
		expect(tagsOf(history, "n1")?.ref).toBe("n1");
		expect(tagsOf(history, "n2")?.ref).toBe("n2");
	});

	it("folds typing into one step, closed by the change leaving the field", () => {
		const history = benches();
		history.patchTags(["n1", "n2"], { name: "P" }, { live: true });
		history.patchTags(["n1", "n2"], { name: "Park " }, { live: true });
		expect(tagsOf(history, "n2")?.name).toBe("Park ");
		history.patchTags(["n1", "n2"], { name: "Park " });
		expect(tagsOf(history, "n2")?.name).toBe("Park");
		// Typing in the same field of other features is a step of its own.
		history.patchTags(["n2"], { name: "Parks" }, { live: true });
		expect(undoAll(history)).toBe(2);
	});

	it("makes no step when no feature changes", () => {
		const history = benches();
		history.patchTags(["n1", "n2"], { amenity: "bench" });
		history.patchTags(["n9"], { amenity: "bench" });
		expect(history.canUndo).toBe(false);
	});
});

describe("EditHistory.preview: a drag shown live, one undo step on release", () => {
	const move = (lon: number) => moveNode("n1", [lon, 48.85]);

	it("shows each move without a step, and makes the last one step on commit", () => {
		const history = benches();
		history.preview(move(1));
		history.preview(move(2));
		expect(history.graph.entity("n1")).toMatchObject({ loc: [2, 48.85] });
		expect(history.canUndo).toBe(false);

		history.commit(move(3), msg("undo_move_node"));
		expect(history.graph.entity("n1")).toMatchObject({ loc: [3, 48.85] });
		expect(history.previewing).toBe(false);
		expect(undoAll(history)).toBe(1);
		expect(history.graph.entity("n1")).toMatchObject({ loc: [2.35, 48.85] });
	});

	it("goes back to the last step when cancelled", () => {
		const history = benches();
		history.setTags("n1", { amenity: "bench" });
		const before = history.graph;
		history.preview(move(1));
		history.cancelPreview();
		expect(history.graph).toBe(before);
		expect(history.canRedo).toBe(false);
	});

	it("keeps the drag over data downloaded meanwhile", () => {
		const history = benches();
		history.preview(move(1));
		history.merge([node("n9", { amenity: "toilets" })]);
		expect(history.graph.entity("n9")).toBeDefined();
		expect(history.graph.entity("n1")).toMatchObject({ loc: [1, 48.85] });
	});

	it("drops the preview when another edit comes first", () => {
		const history = benches();
		history.preview(move(1));
		history.setTags("n2", { amenity: "bench", name: "B" });
		expect(history.previewing).toBe(false);
		expect(history.graph.entity("n1")).toMatchObject({ loc: [2.35, 48.85] });
		expect(history.graph.entity("n2")?.tags.name).toBe("B");
	});

	it("refuses undo and redo while a preview is shown: the drag or drawing still uses that step", () => {
		const history = benches();
		history.setTags("n2", { amenity: "bench", name: "B" });
		history.setTags("n2", { amenity: "bench", name: "C" });
		history.undo();
		history.preview(move(1));
		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(false);
		history.undo();
		history.redo();
		expect(history.previewing).toBe(true);
		expect(history.graph.entity("n2")?.tags.name).toBe("B");
		expect(history.graph.entity("n1")).toMatchObject({ loc: [1, 48.85] });

		history.cancelPreview();
		expect(history.canUndo).toBe(true);
		expect(history.canRedo).toBe(true);
	});

	it("drops the preview when an upload starts: the upload sends the last step", () => {
		const history = benches();
		history.preview(move(1));
		history.lock();
		expect(history.previewing).toBe(false);
		expect(history.graph.entity("n1")).toMatchObject({ loc: [2.35, 48.85] });
		expect(history.editCount).toBe(0);
	});

	it("shows nothing and makes no step while uploading", () => {
		const history = benches();
		history.lock();
		history.preview(move(1));
		history.commit(move(1), msg("undo_move_node"));
		expect(history.graph.entity("n1")).toMatchObject({ loc: [2.35, 48.85] });
	});
});
