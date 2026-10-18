import { describe, expect, it } from "vitest";
import { installSlots, slotId } from "./layer-slots.ts";
import type { Map as MapLibreMap } from "./maplibre.ts";

/** A map stand-in keeping its layers in order, bottom first. */
function fakeMap(basemap: { id: string; type: string }[]) {
	const layers = [...basemap];
	const indexOf = (id: string) => layers.findIndex((l) => l.id === id);
	const map = {
		getStyle: () => ({ layers }),
		getLayer: (id: string) => layers.find((l) => l.id === id),
		addLayer: (layer: { id: string; type: string }, before?: string) => {
			const at = before === undefined ? layers.length : indexOf(before);
			layers.splice(at, 0, layer);
		},
		moveLayer: (id: string, before?: string) => {
			const [layer] = layers.splice(indexOf(id), 1);
			const at = before === undefined ? layers.length : indexOf(before);
			if (layer) layers.splice(at, 0, layer);
		},
	};
	return {
		map: map as unknown as MapLibreMap,
		ids: () => layers.map((l) => l.id),
		/** An owner adding a layer, or moving it, just below `before`. */
		add: (id: string, before?: string) =>
			map.addLayer({ id, type: "fill" }, before),
		move: map.moveLayer,
	};
}

const BASEMAP = [
	{ id: "water", type: "fill" },
	{ id: "roads", type: "line" },
	{ id: "place-labels", type: "symbol" },
	{ id: "poi-labels", type: "symbol" },
];

describe("installSlots: where each kind of layer goes", () => {
	it("puts imagery, indoor fills, plans and indoor lines under the basemap's labels, the rest above", () => {
		const { map, ids } = fakeMap(BASEMAP);
		installSlots(map);
		expect(ids()).toEqual([
			"water",
			"roads",
			"slot:imagery",
			"slot:indoor-fill",
			"slot:plans",
			"slot:indoor-lines",
			"place-labels",
			"poi-labels",
			"slot:indoor-top",
			"slot:edit",
			"slot:tools",
		]);
	});

	it("installs once, and works on a basemap without labels", () => {
		const { map, ids } = fakeMap([{ id: "background", type: "background" }]);
		installSlots(map);
		installSlots(map);
		expect(ids()).toEqual([
			"background",
			"slot:imagery",
			"slot:indoor-fill",
			"slot:plans",
			"slot:indoor-lines",
			"slot:indoor-top",
			"slot:edit",
			"slot:tools",
		]);
	});

	it("keeps layers in their slots whatever order their owners add them in", () => {
		const { map, ids, add, move } = fakeMap(BASEMAP);
		installSlots(map);
		// Tools first, then plans, then imagery, then the indoor layers.
		add("tool-marks", slotId("tools"));
		add("plan-a", slotId("plans"));
		add("imagery", slotId("imagery"));
		add("indoor-fill", slotId("indoor-fill"));
		add("indoor-labels", slotId("indoor-top"));
		move("plan-a", slotId("plans"));
		expect(ids().filter((id) => !id.startsWith("slot:"))).toEqual([
			"water",
			"roads",
			"imagery",
			"indoor-fill",
			"plan-a",
			"place-labels",
			"poi-labels",
			"indoor-labels",
			"tool-marks",
		]);
	});
});
