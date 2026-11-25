import { flushSync } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import {
	attachEditorLayers,
	type EditorLayerInputs,
} from "#lib/map/editor-layers.svelte.ts";
import { IndoorMap } from "#lib/map/indoor-map.ts";
import { Map as MapLibreMap } from "#lib/map/maplibre.ts";
import { FloorPlans } from "#lib/state/floorplans.svelte.ts";

const SOURCES = [
	"edit-overlay",
	"precision-guides",
	"precision-construction",
	"precision-grid",
	"floorplan-tool",
];

let map: MapLibreMap | undefined;
afterEach(() => {
	map?.remove();
	map = undefined;
	document.body.replaceChildren();
});

async function blankMap(): Promise<MapLibreMap> {
	const container = document.createElement("div");
	container.style.width = "400px";
	container.style.height = "300px";
	document.body.append(container);
	const created = new MapLibreMap({
		container,
		style: { version: 8, sources: {}, layers: [] },
		center: [0, 0],
		zoom: 18,
		attributionControl: false,
	});
	map = created;
	await created.once("load");
	return created;
}

function inputs(state: { nudging: boolean }): EditorLayerInputs {
	const empty = { type: "FeatureCollection" as const, features: [] };
	return {
		floorplans: new FloorPlans(),
		planMode: () => false,
		level: () => 0,
		overlay: () => empty,
		selectionColor: () => "#ff0000",
		feedback: () => null,
		nudging: () => state.nudging,
		guides: () => [],
		highlightedGuide: () => null,
		gridStyle: () => ({
			color: "#999999",
			minorOpacity: 0.3,
			majorOpacity: 0.6,
		}),
		gridLines: () => [],
		planMarks: () => empty,
		ontiles: () => {},
	};
}

/** Waits until the layers, installed once the map's slots are ready, have their sources. */
async function installed(m: MapLibreMap, ids: readonly string[]) {
	await expect.poll(() => ids.every((id) => m.getSource(id))).toBe(true);
}

describe("attachEditorLayers", () => {
	it("adds the editor's layers, and takes them off on remove", async () => {
		const m = await blankMap();
		const indoor = new IndoorMap(m);
		let layers: ReturnType<typeof attachEditorLayers> | undefined;
		const stop = $effect.root(() => {
			layers = attachEditorLayers(m, indoor, inputs({ nudging: false }));
		});
		await installed(m, SOURCES);

		stop();
		layers?.remove();
		expect(SOURCES.filter((id) => m.getSource(id))).toEqual([]);
	});

	it("follows what its inputs read: arrow keys nudge while something is selected", async () => {
		const m = await blankMap();
		const indoor = new IndoorMap(m);
		const state = $state({ nudging: false });
		const stop = $effect.root(() => {
			attachEditorLayers(m, indoor, inputs(state));
		});
		flushSync();
		expect(m.keyboard.isEnabled()).toBe(true);

		state.nudging = true;
		flushSync();
		expect(m.keyboard.isEnabled()).toBe(false);

		state.nudging = false;
		flushSync();
		expect(m.keyboard.isEnabled()).toBe(true);
		stop();
	});
});
