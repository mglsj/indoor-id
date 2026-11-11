import { describe, expect, it } from "vitest";
import type { IndoorFeature } from "#lib/map/features.ts";
import { placeOf, placesOf, placesOnLevel, searchPlaces } from "./places.ts";

function square(
	id: string,
	x: number,
	properties: Record<string, string>,
): IndoorFeature {
	return {
		type: "Feature",
		geometry: {
			type: "Polygon",
			coordinates: [
				[
					[x, 0],
					[x + 2, 0],
					[x + 2, 2],
					[x, 2],
					[x, 0],
				],
			],
		},
		properties: { "@id": id, "@lv": ";0;", "@kind": "room", ...properties },
	};
}

const features = [
	square("w1", 0, {
		"@label": "Bibliothèque",
		name: "Bibliothèque",
		ref: "B10",
	}),
	square("w2", 10, { "@label": "B2", ref: "B2", "@lv": ";1;" }),
	square("w3", 20, { "@label": "Hall", "@kind": "space", "@lv": "*" }),
	square("w4", 30, { "@kind": "room" }),
	square("w5", 40, { "@label": "Ground", indoor: "level" }),
	square("w6", 50, { "@label": "Main", "@kind": "building" }),
];

describe("placeOf", () => {
	it("lists named rooms and spaces, centred, with their levels", () => {
		expect(placeOf(features[0] as IndoorFeature)).toEqual({
			id: "w1",
			label: "Bibliothèque",
			ref: "B10",
			kind: "room",
			levels: [0],
			loc: [1, 1],
		});
		expect(placeOf(features[2] as IndoorFeature)?.levels).toBeNull();
	});

	it("leaves out unnamed features, level outlines and buildings", () => {
		expect(placeOf(features[3] as IndoorFeature)).toBeNull();
		expect(placeOf(features[4] as IndoorFeature)).toBeNull();
		expect(placeOf(features[5] as IndoorFeature)).toBeNull();
	});
});

describe("placesOf and searchPlaces", () => {
	const places = placesOf(features);

	it("sorts by label, numbers in order", () => {
		expect(places.map((p) => p.label)).toEqual(["B2", "Bibliothèque", "Hall"]);
	});

	it("finds places by name or ref, ignoring case and accents, starting matches first", () => {
		expect(searchPlaces(places, "biblio").map((p) => p.id)).toEqual(["w1"]);
		expect(searchPlaces(places, "b10").map((p) => p.id)).toEqual(["w1"]);
		expect(searchPlaces(places, "b").map((p) => p.id)).toEqual(["w2", "w1"]);
		expect(searchPlaces(places, "THEQUE").map((p) => p.id)).toEqual(["w1"]);
		expect(searchPlaces(places, "  ")).toEqual([]);
	});
});

describe("placesOnLevel", () => {
	it("keeps the places on the level, or on every level, inside the extent", () => {
		const places = placesOf(features);
		const all = { west: -1, south: -1, east: 100, north: 100 };
		expect(placesOnLevel(places, 0, all).map((p) => p.id)).toEqual([
			"w1",
			"w3",
		]);
		expect(placesOnLevel(places, 1, all).map((p) => p.id)).toEqual([
			"w2",
			"w3",
		]);
		expect(
			placesOnLevel(places, 0, { west: -1, south: -1, east: 5, north: 5 }).map(
				(p) => p.id,
			),
		).toEqual(["w1"]);
	});
});
