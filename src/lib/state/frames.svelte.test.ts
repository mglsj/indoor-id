import { describe, expect, it } from "vitest";
import type { IndoorFeature } from "#lib/map/features.ts";
import type { Loc } from "#lib/osm/entity.ts";
import { fromLocal } from "#lib/osm/geometry.ts";
import type { FrameStore, StoredFrame } from "#lib/persist/plan-store.ts";
import { Frames } from "./frames.svelte.ts";

const O: Loc = [11.575, 48.137];
const at = (east: number, north: number) => fromLocal(O, [east, north]);

/** A 20 × 10 m building turned 30°. */
function building(): IndoorFeature {
	const r = Math.PI / 6;
	const p = (x: number, y: number) =>
		at(x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r));
	return {
		type: "Feature",
		properties: { "@id": "w7", "@lv": "*", building: "yes" },
		geometry: {
			type: "Polygon",
			coordinates: [[p(0, 0), p(20, 0), p(20, 10), p(0, 10), p(0, 0)]],
		},
	};
}

function store(): FrameStore & { saved: Map<string, StoredFrame> } {
	const saved = new Map<string, StoredFrame>();
	return {
		saved,
		loadFrames: async () => new Map(saved),
		saveFrame: async (id, frame) => {
			if (frame) saved.set(id, frame);
			else saved.delete(id);
		},
	};
}

describe("Frames", () => {
	it("gives a building's own frame where nothing was set", () => {
		const frame = new Frames().at([building()], at(0, 5), 0);
		expect(frame?.id).toBe("w7");
		expect(frame?.set).toBe(false);
		expect(frame?.frame.angle).toBeCloseTo(30, 4);
	});

	it("nothing outside a building", () => {
		expect(new Frames().at([building()], at(-50, 0), 0)).toBeNull();
	});

	it("keeps the angle the user set, and its origin, until reset", async () => {
		const saved = store();
		const frames = new Frames(saved);
		frames.set("w7", { angle: 10 });
		expect(frames.at([building()], at(0, 5), 0)?.frame.angle).toBe(10);
		frames.set("w7", { angle: 10, origin: [1, 2] });
		frames.set("w7", { angle: 12 });
		expect(saved.saved.get("w7")).toEqual({ angle: 12, origin: [1, 2] });

		const again = new Frames(saved);
		await again.load();
		expect(again.of("w7", { origin: O, angle: 30 }).frame).toEqual({
			angle: 12,
			origin: [1, 2],
		});
		again.reset("w7");
		expect(again.of("w7", { origin: O, angle: 30 }).set).toBe(false);
		expect(saved.saved.size).toBe(0);
	});
});
