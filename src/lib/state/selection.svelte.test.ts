import { describe, expect, it } from "vitest";
import { Selection } from "./selection.svelte.ts";

describe("Selection: the selected features and the hovered one", () => {
	it("starts empty, and selects one feature, several, or none", () => {
		const selection = new Selection();
		expect(selection.ids).toEqual([]);
		expect(selection.single).toBeNull();
		selection.select("w1");
		expect(selection.ids).toEqual(["w1"]);
		expect(selection.single).toBe("w1");
		selection.select(["w1", "n2"]);
		expect(selection.ids).toEqual(["w1", "n2"]);
		// Several: no single feature to edit.
		expect(selection.single).toBeNull();
		selection.select(null);
		expect(selection.ids).toEqual([]);
	});

	it("selects each feature once", () => {
		const selection = new Selection();
		selection.select(["w1", "w1", "n2"]);
		expect(selection.ids).toEqual(["w1", "n2"]);
	});

	it("toggles a feature in or out, as Shift+click", () => {
		const selection = new Selection();
		selection.select("w1");
		selection.toggle("n2");
		expect(selection.ids).toEqual(["w1", "n2"]);
		expect(selection.has("n2")).toBe(true);
		selection.toggle("w1");
		expect(selection.ids).toEqual(["n2"]);
		expect(selection.has("w1")).toBe(false);
	});

	it("keeps the hovered feature apart from the selection", () => {
		const selection = new Selection();
		selection.select("w1");
		selection.setHover("w2");
		expect(selection.hover).toBe("w2");
		expect(selection.ids).toEqual(["w1"]);
		selection.setHover(null);
		expect(selection.hover).toBeNull();
	});

	it("follows the ids an upload gives to new features", () => {
		const selection = new Selection();
		selection.select(["n-1", "w5"]);
		selection.setHover("w-2");
		selection.remap(
			new Map([
				["n-1", "n100"],
				["w-2", "w101"],
			]),
		);
		expect(selection.ids).toEqual(["n100", "w5"]);
		expect(selection.hover).toBe("w101");
	});
});
