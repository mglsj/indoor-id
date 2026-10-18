/**
 * Where each kind of layer goes on the map, bottom first. Invisible anchor layers ("slots") are
 * installed once; every owner adds or moves its layers just below a slot, so the order never
 * depends on which owner installed first or on other modules' layer ids.
 *
 * Under the basemap's labels: imagery, indoor fills, floor plans, indoor outlines and lines.
 * Above them: indoor doors, labels and the selection, the edit overlay, the tools' marks.
 */
import type { Map as MapLibreMap } from "./maplibre.ts";
import { styleReady } from "./ready.ts";

const BELOW_LABELS = [
	"imagery",
	"indoor-fill",
	"plans",
	"indoor-lines",
] as const;
const ABOVE_LABELS = ["indoor-top", "edit", "tools"] as const;

export type Slot =
	| (typeof BELOW_LABELS)[number]
	| (typeof ABOVE_LABELS)[number];

/** The id of a slot's anchor layer: pass it as `beforeId` to put a layer in the slot. */
export function slotId(slot: Slot): string {
	return `slot:${slot}`;
}

/** Adds the slots' anchor layers, unless they are there already. */
export function installSlots(map: MapLibreMap): void {
	if (map.getLayer(slotId("tools"))) return;
	const firstLabel = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
	const anchor = (slot: Slot, before?: string) =>
		map.addLayer(
			{ id: slotId(slot), type: "background", layout: { visibility: "none" } },
			before,
		);
	for (const slot of BELOW_LABELS) anchor(slot, firstLabel);
	for (const slot of ABOVE_LABELS) anchor(slot);
}

/** Resolves once the style is ready and the slots are installed. */
export async function slotsReady(map: MapLibreMap): Promise<void> {
	await styleReady(map);
	installSlots(map);
}
