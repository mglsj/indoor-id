import { describe, expect, it } from "vitest";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { loadPresetIndex } from "#lib/presets/load.ts";
import { LOCAL_UPGRADES, type UpgradeRule } from "#lib/validation/upgrades.ts";
import { Catalog } from "./catalog.svelte.ts";

const NO_STORAGE = { getItem: () => null, setItem: () => {} };

/** A catalog whose data loads when `release()` is called. */
function pending() {
	let release = () => {};
	const gate = new Promise<void>((resolve) => (release = resolve));
	const catalog = new Catalog({
		services: { searchWikipedia: async () => ["Paris"] },
		storage: NO_STORAGE,
		load: {
			presets: () => gate.then(loadPresetIndex),
			upgrades: () =>
				gate.then((): UpgradeRule[] => [
					{ old: { amenity: "toilet" }, replace: { amenity: "toilets" } },
					{ old: { shop: "*" }, replace: {} },
				]),
			discardedKeys: () => gate.then(() => ["created_by"]),
		},
	});
	return { catalog, release };
}

describe("Catalog: presets, tag upgrades and web services", () => {
	it("works with local upgrades only until the schema's data has loaded", async () => {
		const { catalog, release } = pending();
		expect(catalog.presets).toBeNull();
		expect(catalog.upgrades).toEqual(LOCAL_UPGRADES);
		expect(catalog.discardedKeys).toEqual([]);
		release();
		await catalog.loaded;
		expect(catalog.presets).not.toBeNull();
		expect(catalog.upgrades.length).toBe(LOCAL_UPGRADES.length + 2);
		expect(catalog.discardedKeys).toEqual(["created_by"]);
	});

	it("lists the values the schema deprecates, by key, not whole keys", async () => {
		const { catalog, release } = pending();
		release();
		await catalog.loaded;
		expect(catalog.deprecatedValues.get("amenity")).toContain("toilet");
		expect(catalog.deprecatedValues.has("shop")).toBe(false);
	});

	it("matches a feature's preset by its tags and geometry in a graph", async () => {
		const { catalog, release } = pending();
		const graph = Graph.fromEntities([
			node("n1", {}, [0, 0]),
			node("n2", {}, [1, 0]),
			node("n3", {}, [1, 1]),
			way("w1", ["n1", "n2", "n3", "n1"], { indoor: "room" }),
		]);
		const room = graph.entity("w1");
		if (!room) throw new Error("no room");
		expect(catalog.presetOf(graph, room)).toBeUndefined();
		release();
		await catalog.loaded;
		expect(catalog.geometryOf(graph, room)).toBe("area");
		expect(catalog.presetOf(graph, room)?.id).toBe("indoor/room");
	});

	it("holds the web services it was given", async () => {
		const { catalog } = pending();
		expect(await catalog.services.searchWikipedia?.("en", "Par")).toEqual([
			"Paris",
		]);
		expect(catalog.services.taginfo).toBeUndefined();
	});
});
