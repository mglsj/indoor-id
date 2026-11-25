import { describe, expect, it } from "vitest";
import { AppearanceSettings, DEFAULT_APPEARANCE } from "./appearance.svelte.ts";

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

describe("AppearanceSettings (A.4)", () => {
	it("starts from colours visible on the light map, not the guides' magenta for the grid", () => {
		const settings = new AppearanceSettings(storage());
		expect(settings.current).toEqual(DEFAULT_APPEARANCE);
		expect(settings.gridColor).not.toBe(settings.guideColor);
		expect(settings.editPalette).toBe("indoorid");
	});

	it("keeps what is changed in this browser", () => {
		const saved = storage();
		new AppearanceSettings(saved).set({
			gridColor: "#FF0000",
			gridMinorOpacity: 0.3,
			selectionColor: "#00aa00",
			editPalette: "id",
		});
		const again = new AppearanceSettings(saved);
		expect(again.gridColor).toBe("#ff0000");
		expect(again.gridMinorOpacity).toBe(0.3);
		expect(again.selectionColor).toBe("#00aa00");
		expect(again.editPalette).toBe("id");
		again.reset();
		expect(new AppearanceSettings(saved).current).toEqual(DEFAULT_APPEARANCE);
	});

	it("ignores values that aren't colours, opacities or palettes", () => {
		const settings = new AppearanceSettings(
			storage({
				"indoorid.appearance": JSON.stringify({
					gridColor: "red",
					gridMajorOpacity: 4,
					editPalette: "neon",
					guideColor: "#123456",
				}),
			}),
		);
		expect(settings.gridColor).toBe(DEFAULT_APPEARANCE.gridColor);
		expect(settings.gridMajorOpacity).toBe(DEFAULT_APPEARANCE.gridMajorOpacity);
		expect(settings.editPalette).toBe("indoorid");
		expect(settings.guideColor).toBe("#123456");
		settings.set({ selectionColor: "blue" });
		expect(settings.selectionColor).toBe(DEFAULT_APPEARANCE.selectionColor);
	});
});
