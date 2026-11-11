import { describe, expect, it } from "vitest";
import { PrecisionSettings } from "./precision.svelte.ts";

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

describe("PrecisionSettings", () => {
	it("snaps to everything, angles every 15°, at first", () => {
		const settings = new PrecisionSettings(storage());
		expect(settings.enabled).toBe(true);
		expect(settings.step).toBe(15);
		expect(settings.snaps("midpoints")).toBe(true);
	});

	it("takes its units from the browser's language", () => {
		expect(new PrecisionSettings(storage(), "en-US").units).toBe("imperial");
		expect(new PrecisionSettings(storage(), "fr-FR").units).toBe("metric");
	});

	it("turned off, nothing snaps and there is no angle step", () => {
		const settings = new PrecisionSettings(storage());
		settings.toggle();
		expect(settings.snaps("points")).toBe(false);
		expect(settings.step).toBeNull();
	});

	it("keeps its choices", () => {
		const saved = storage();
		const settings = new PrecisionSettings(saved, "en-US");
		settings.setAngleStep(45);
		settings.setOption("midpoints", false);
		settings.setUnits("metric");
		settings.toggle();

		const again = new PrecisionSettings(saved, "en-US");
		expect(again.enabled).toBe(false);
		expect(again.angleStep).toBe(45);
		expect(again.options.midpoints).toBe(false);
		expect(again.options.angles).toBe(true);
		expect(again.units).toBe("metric");
	});

	it("turning a kind on turns snapping on", () => {
		const settings = new PrecisionSettings(storage());
		settings.toggle();
		settings.setOption("angles", true);
		expect(settings.enabled).toBe(true);
	});

	it("keeps the grid hidden at first, then shown with its spacing", () => {
		const saved = storage();
		const settings = new PrecisionSettings(saved);
		expect(settings.grid).toBe(false);
		settings.toggleGrid();
		expect(settings.setGridSpacing(1, 0.5)).toBe(false);
		expect(settings.setGridSpacing(0.6, 6)).toBe(true);
		const again = new PrecisionSettings(saved);
		expect([again.grid, again.gridMinor, again.gridMajor]).toEqual([
			true,
			0.6,
			6,
		]);
	});

	it("ignores what it can't read", () => {
		const settings = new PrecisionSettings(
			storage({
				"indoorid.precision":
					'{"angleStep":7,"units":"cubits","options":{"angles":"no"}}',
			}),
		);
		expect(settings.angleStep).toBe(15);
		expect(settings.units).toBe("metric");
		expect(settings.options.angles).toBe(true);
	});
});
