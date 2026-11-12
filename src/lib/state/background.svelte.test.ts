import { describe, expect, it } from "vitest";
import {
	BackgroundSettings,
	formatOffset,
	parseOffset,
} from "./background.svelte.ts";

/** A `Storage` holding `items`. */
function storage(items: Record<string, string> = {}): Storage {
	const data = new Map(Object.entries(items));
	return {
		get length() {
			return data.size;
		},
		clear: () => data.clear(),
		getItem: (key) => data.get(key) ?? null,
		key: (i) => [...data.keys()][i] ?? null,
		removeItem: (key) => void data.delete(key),
		setItem: (key, value) => void data.set(key, value),
	};
}

describe("BackgroundSettings", () => {
	it("fills areas partly at first, and keeps the fill chosen", () => {
		const saved = storage();
		const settings = new BackgroundSettings(saved);
		expect(settings.areaFill).toBe("partial");
		settings.setAreaFill("full");
		expect(new BackgroundSettings(saved).areaFill).toBe("full");
		expect(
			new BackgroundSettings(storage({ "indoorid.area-fill": "dotted" }))
				.areaFill,
		).toBe("partial");
	});

	it("swaps back to the background shown before (iD's Mod+B)", () => {
		const settings = new BackgroundSettings(storage());
		settings.swapPrevious();
		expect(settings.id).toBe("map");
		settings.choose("esri");
		settings.swapPrevious();
		expect(settings.id).toBe("map");
		settings.swapPrevious();
		expect(settings.id).toBe("esri");
	});

	it("keeps whether edits are highlighted, off at first", () => {
		const saved = storage();
		const settings = new BackgroundSettings(saved);
		expect(settings.highlightEdits).toBe(false);
		settings.setHighlightEdits(true);
		expect(new BackgroundSettings(saved).highlightEdits).toBe(true);
	});

	it("keeps the imagery's display values in range", () => {
		const settings = new BackgroundSettings(storage());
		settings.setDisplay("brightness", 0.1);
		settings.setDisplay("contrast", 3);
		expect(settings.display).toEqual({
			brightness: 0.25,
			contrast: 2,
			saturation: 1,
		});
	});

	it("toggles the wireframe and back to the fill shown before (iD's W)", () => {
		const settings = new BackgroundSettings(storage());
		settings.setAreaFill("full");
		settings.toggleWireframe();
		expect(settings.areaFill).toBe("wireframe");
		settings.toggleWireframe();
		expect(settings.areaFill).toBe("full");
	});

	it("shows the map alone at first", () => {
		const settings = new BackgroundSettings(storage());
		expect(settings.id).toBe("map");
		expect(settings.imagery).toBeNull();
		expect(settings.offset).toEqual({ east: 0, north: 0 });
	});

	it("keeps the choice, the custom URL and each imagery's offset", () => {
		const saved = storage();
		const settings = new BackgroundSettings(saved);
		settings.choose("esri");
		settings.nudge(1.5, -0.25);
		settings.setCustom(" https://t.example.org/{z}/{x}/{y}.png ");
		settings.setOffset({ east: -2, north: 3 });

		const again = new BackgroundSettings(saved);
		expect(again.id).toBe("custom");
		expect(again.imagery?.name).toBe(
			"Custom (https://t.example.org/{z}/{x}/{y}.png)",
		);
		expect(again.offset).toEqual({ east: -2, north: 3 });
		again.choose("esri");
		expect(again.offset).toEqual({ east: 1.5, north: -0.25 });
		expect(again.imagery?.name).toBe("Esri World Imagery");
	});

	it("doesn't move the map", () => {
		const settings = new BackgroundSettings(storage());
		settings.nudge(5, 5);
		expect(settings.offset).toEqual({ east: 0, north: 0 });
	});

	it("rounds offsets to the centimetre", () => {
		const settings = new BackgroundSettings(storage());
		settings.choose("esri-clarity");
		settings.setOffset({ east: 0.123, north: -4.567 });
		expect(settings.offset).toEqual({ east: 0.12, north: -4.57 });
	});

	it("ignores saved settings it can't read", () => {
		const settings = new BackgroundSettings(
			storage({ "indoorid.background": '{"id":"bing","offsets":{"esri":7}}' }),
		);
		expect(settings.id).toBe("map");
		expect(
			new BackgroundSettings(storage({ "indoorid.background": "{" })).id,
		).toBe("map");
	});
});

describe("parseOffset", () => {
	it("reads east and north metres as iD writes them", () => {
		expect(parseOffset("1.5, -2")).toEqual({ east: 1.5, north: -2 });
		expect(parseOffset(" 0 3 ")).toEqual({ east: 0, north: 3 });
		expect(formatOffset({ east: 1.5, north: -2 })).toBe("1.5, -2");
	});

	it.each(["", "1", "1, 2, 3", "a, b"])("refuses %j", (text) => {
		expect(parseOffset(text)).toBeNull();
	});
});
