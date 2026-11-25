import { describe, expect, it, vi } from "vitest";
import type { MapPoint } from "#lib/edit/mode.ts";
import type { Entity } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import type { PresetIndex } from "#lib/presets/presets.ts";
import {
	BuildingScopeController,
	type ScopeHost,
} from "./building-scope-controller.svelte.ts";
import { Catalog } from "./catalog.svelte.ts";
import { Editor } from "./editor.svelte.ts";

const NO_STORAGE = { getItem: () => null, setItem: () => {} };

/** A building w1 (0..10 × 0..10) named "Hall" with a room w2 inside, and an empty spot at 20. */
function setup(stored: Record<string, string> = {}) {
	const entities: Entity[] = [
		node("n1", {}, [0, 0]),
		node("n2", {}, [0.0001, 0]),
		node("n3", {}, [0.0001, 0.0001]),
		node("n4", {}, [0, 0.0001]),
		way("w1", ["n1", "n2", "n3", "n4", "n1"], {
			building: "yes",
			name: "Hall",
		}),
		node("n5", {}, [0.00002, 0.00002]),
		node("n6", {}, [0.00004, 0.00002]),
		node("n7", {}, [0.00004, 0.00004]),
		node("n8", {}, [0.00002, 0.00004]),
		way("w2", ["n5", "n6", "n7", "n8", "n5"], { indoor: "room", level: "0" }),
	];
	const loadMap = vi.fn(async () => []);
	const editor = new Editor({
		api: {
			loadMap,
			loadRelation: async () => [],
			loadEntities: async () => [],
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
	const log: string[] = [];
	const host: ScopeHost = {
		finishTools: () => log.push("finish"),
		planMode: () => false,
		fit: () => log.push("fit"),
		groundFloor: () => log.push("ground floor"),
		buildingAt: () => null,
	};
	const storage = {
		values: { ...stored },
		getItem(key: string) {
			return this.values[key] ?? null;
		},
		setItem(key: string, value: string) {
			this.values[key] = value;
		},
	};
	const controller = new BuildingScopeController(editor, host, storage);
	const stop = () => controller.destroy();
	return { editor, controller, log, storage, stop, loadMap };
}

const at = (lon: number, lat: number): MapPoint => ({
	point: { x: 0, y: 0 },
	lngLat: [lon, lat],
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
});

describe("BuildingScopeController", () => {
	it("enters the selected building, fitting it, names it and hints the first times", () => {
		const { editor, controller, log, storage, stop } = setup();
		editor.select("w1");
		expect(controller.enterable).toBe("w1");
		controller.enter("w1");
		controller.scopeChanged();
		expect(editor.scope.id).toBe("w1");
		expect(editor.selection.ids).toEqual([]);
		expect(log).toEqual(["finish", "fit"]);
		expect(controller.name).toBe("Hall");
		expect(controller.enteredHint).toMatchObject({
			key: "building_entered_hint",
			params: { name: "Hall" },
		});
		expect(storage.values["indoorid.building-hints"]).toBe("1");
		expect(controller.offered).toMatchObject({ levels: true });
		stop();
	});

	it("shows no hint once shown three times", () => {
		const { controller, stop } = setup({ "indoorid.building-hints": "3" });
		controller.enter("w1");
		controller.scopeChanged();
		expect(controller.enteredHint).toBeNull();
		stop();
	});

	it("leaves to the ground floor, selecting the building left", () => {
		const { editor, controller, log, stop } = setup();
		controller.enter("w1");
		controller.scopeChanged();
		controller.leave();
		controller.scopeChanged();
		expect(editor.scope.active).toBe(false);
		expect(editor.selection.ids).toEqual(["w1"]);
		expect(log.slice(-2)).toEqual(["finish", "ground floor"]);
		expect(controller.enteredHint).toBeNull();
		stop();
	});

	it("enters a room's building on a click from the map, without moving the camera", () => {
		const { editor, controller, log, stop } = setup();
		controller.selectOrEnter("w2", at(0.00003, 0.00003));
		expect(editor.scope.id).toBe("w1");
		expect(editor.selection.ids).toEqual(["w2"]);
		expect(log).not.toContain("fit");
		stop();
	});

	it("offers to enter the building around a click on the empty map, else the loose data", () => {
		const { editor, controller, stop } = setup();
		controller.selectOrEnter(null, at(0.00008, 0.00008));
		expect(controller.here).toBe("w1");
		expect(controller.hereOffered).toBe(true);
		controller.selectOrEnter(null, at(1, 1));
		expect(controller.here).toBeNull();
		controller.enterHere();
		expect(editor.scope.loose).toBe(true);
		stop();
	});

	it("downloads the building entered whole, once", () => {
		const { controller, loadMap, stop } = setup();
		controller.enter("w1");
		controller.downloadEntered();
		controller.downloadEntered();
		expect(loadMap).toHaveBeenCalledTimes(1);
		stop();
	});

	it("enters on a double-click the building there, not the one already entered", () => {
		const { controller, stop } = setup();
		expect(controller.enterableAt(at(0.00008, 0.00008))).toBe("w1");
		controller.enter("w1");
		expect(controller.enterableAt(at(0.00008, 0.00008))).toBeNull();
		stop();
	});
});
