import { describe, expect, it } from "vitest";
import { fromMercator, pointInPolygon, toMercator } from "#lib/osm/geometry.ts";
import { areaBand, BandStore, bandWidth } from "./area-bands.ts";

/** A polygon from corners in Web Mercator metres (near 0, 0), in longitude and latitude. */
function polygon(...corners: [number, number][]) {
	const ring = [...corners, corners[0] as [number, number]].map((c) =>
		fromMercator(c),
	);
	return { type: "Polygon" as const, coordinates: [ring] };
}

/** Area of a multipolygon, in square Web Mercator metres (shoelace, holes subtracted). */
function area(coordinates: number[][][][]): number {
	let total = 0;
	for (const rings of coordinates) {
		rings.forEach((ring, i) => {
			let sum = 0;
			const m = ring.map((p) => toMercator(p));
			for (let k = 0; k + 1 < m.length; k++) {
				const [x1 = 0, y1 = 0] = m[k] ?? [];
				const [x2 = 0, y2 = 0] = m[k + 1] ?? [];
				sum += x1 * y2 - x2 * y1;
			}
			total += (i === 0 ? 1 : -1) * Math.abs(sum / 2);
		});
	}
	return total;
}

describe("areaBand", () => {
	it("is the square minus the square shrunk by the width", () => {
		const band = areaBand(polygon([0, 0], [10, 0], [10, 10], [0, 10]), 1);
		expect(band?.coordinates).toHaveLength(1);
		// 100 − 8 × 8.
		expect(area(band?.coordinates ?? [])).toBeCloseTo(36, 1);
	});

	it("stays inside an L-shaped room, without overlaps in its inner corner", () => {
		const room = polygon(
			[0, 0],
			[20, 0],
			[20, 10],
			[10, 10],
			[10, 20],
			[0, 20],
		);
		const band = areaBand(room, 2);
		const ring = room.coordinates[0] ?? [];
		for (const rings of band?.coordinates ?? []) {
			for (const p of rings.flat(0)) {
				for (const q of p) {
					// On the outline or inside it, nudged in by a millimetre.
					const [x = 0, y = 0] = toMercator(q);
					const inside = [
						[x + 0.001, y + 0.001],
						[x - 0.001, y + 0.001],
						[x + 0.001, y - 0.001],
						[x - 0.001, y - 0.001],
					].some((r) =>
						pointInPolygon(fromMercator(r as [number, number]), [ring]),
					);
					expect(inside).toBe(true);
				}
			}
		}
		// The room (300 m²) less what lies over 2 m from its outline, a little over 6 × 16 × 2.
		const covered = area(band?.coordinates ?? []);
		expect(covered).toBeGreaterThan(300 - 6 * 16 * 2 - 6 * 6);
		expect(covered).toBeLessThan(300 - 6 * 16 * 2 + 6 * 6);
	});

	it("fills a room narrower than twice the width whole", () => {
		const corridor = polygon([0, 0], [30, 0], [30, 1.5], [0, 1.5]);
		const band = areaBand(corridor, 1);
		expect(area(band?.coordinates ?? [])).toBeCloseTo(45, 1);
	});
});

describe("bandWidth", () => {
	it("is iD's 10 px inside rooms, 30 px inside buildings, from zoom 19", () => {
		// 512 px tiles: 2π × 6378137 / (512 × 2^19) ≈ 0.1493 m per pixel at zoom 19.
		expect(bandWidth("room", 19)).toBeCloseTo(1.493, 3);
		expect(bandWidth("building", 19)).toBeCloseTo(4.479, 3);
		// Half as wide at zoom 17, in pixels.
		expect(bandWidth("room", 17)).toBeCloseTo(1.493 * 2, 3);
	});
});

describe("BandStore", () => {
	const room = {
		id: "w1",
		geometry: polygon([0, 0], [10, 0], [10, 10], [0, 10]),
		properties: { "@id": "w1", "@kind": "room" },
	};
	const far = { west: 50, south: 50, east: 60, north: 60 };
	const here = { west: -1, south: -1, east: 1, north: 1 };

	it("builds bands for the areas in view, once per zoom", () => {
		const store = new BandStore();
		expect(store.update([room], far, 19)).toEqual({
			features: [],
			changed: false,
		});
		const first = store.update([room], here, 19);
		expect(first.changed).toBe(true);
		expect(first.features).toHaveLength(1);
		expect(store.update([room], here, 19).changed).toBe(false);
		expect(store.update([room], here, 19.5).changed).toBe(true);
		expect(
			store.update(
				[{ ...room, properties: { ...room.properties } }],
				here,
				19.5,
			).changed,
		).toBe(true);
	});
});
