import { describe, expect, it } from "vitest";
import type { Bbox } from "#lib/api/osm-api.ts";
import type { IndoorCentre } from "#lib/api/overpass.ts";
import { centresCollection, Discovery } from "./discovery.svelte.ts";

/** About 2 km around Rennes: one or two zoom-12 tiles. */
const VIEW: Bbox = { west: -1.7, south: 48.1, east: -1.68, north: 48.12 };

function setup() {
	const asked: Bbox[] = [];
	const discovery = new Discovery({
		load: async (bbox): Promise<IndoorCentre[]> => {
			asked.push(bbox);
			return [
				{ id: "w1", loc: [-1.69, 48.11] },
				{ id: "r2", loc: [-1.691, 48.111] },
			];
		},
		maxZoom: 16,
		schedule: (run) => run(),
	});
	return { discovery, asked };
}

describe("Discovery", () => {
	it("downloads centres between zoom 12 and the data zoom, each tile once", async () => {
		const { discovery, asked } = setup();
		await discovery.loadView(VIEW, 11);
		await discovery.loadView(VIEW, 16);
		expect(asked).toEqual([]);
		await discovery.loadView(VIEW, 14);
		const tiles = asked.length;
		expect(tiles).toBeGreaterThan(0);
		expect([...discovery.centres.keys()]).toEqual(["w1", "r2"]);
		await discovery.loadView(VIEW, 15);
		expect(asked).toHaveLength(tiles);
	});

	it("says at which zooms bubbles show", () => {
		const { discovery } = setup();
		expect(discovery.shows(11.9)).toBe(false);
		expect(discovery.shows(12)).toBe(true);
		expect(discovery.shows(15.9)).toBe(true);
		expect(discovery.shows(16)).toBe(false);
	});
});

describe("centresCollection", () => {
	it("makes a point per centre, keeping its feature id", () => {
		expect(centresCollection(new Map([["w1", [1, 2]]]))).toEqual({
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					properties: { "@id": "w1" },
					geometry: { type: "Point", coordinates: [1, 2] },
				},
			],
		});
	});
});
