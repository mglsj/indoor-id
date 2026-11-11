import { describe, expect, it } from "vitest";
import type { IndoorFeature } from "#lib/map/features.ts";
import { roomUses, useOf } from "./room-use.ts";

function square(
	id: string,
	properties: Record<string, string>,
	lv = ";0;",
): IndoorFeature {
	return {
		type: "Feature",
		geometry: {
			type: "Polygon",
			coordinates: [
				[
					[0, 0],
					[2, 0],
					[2, 2],
					[0, 2],
					[0, 0],
				],
			],
		},
		properties: { "@id": id, "@lv": lv, "@kind": "room", ...properties },
	};
}

function point(
	id: string,
	properties: Record<string, string>,
	lv = ";0;",
	at: [number, number] = [1, 1],
): IndoorFeature {
	return {
		type: "Feature",
		geometry: { type: "Point", coordinates: at },
		properties: { "@id": id, "@lv": lv, "@kind": "poi", ...properties },
	};
}

describe("useOf", () => {
	it("reads a use from amenity, shop, office, healthcare and room", () => {
		expect(useOf({ amenity: "cafe" })).toBe("food");
		expect(useOf({ shop: "books" })).toBe("shop");
		expect(useOf({ room: "toilets" })).toBe("toilets");
		expect(useOf({ healthcare: "doctor" })).toBe("health");
		expect(useOf({ room: "class" })).toBe("education");
		expect(useOf({ office: "company" })).toBe("office");
		expect(useOf({ amenity: "place_of_worship" })).toBe("worship");
		expect(useOf({ amenity: "post_office" })).toBe("service");
		expect(useOf({ indoor: "area", railway: "platform" })).toBe("platform");
		expect(useOf({ indoor: "room", room: "storage" })).toBeNull();
		expect(useOf({ indoor: "room" })).toBeNull();
	});
});

describe("roomUses", () => {
	it("colours a room by its own tags, else by the first point inside it", () => {
		expect(
			roomUses([
				square("w1", { indoor: "room", shop: "books" }),
				square("w2", { indoor: "room" }),
				point("n1", { amenity: "cafe" }),
			]),
		).toEqual(
			new Map([
				["w1", "shop"],
				["w2", "food"],
			]),
		);
	});

	it("leaves out doors, points outside, and points not on the room's floor", () => {
		const room = square("w1", { indoor: "room" }, ";0;1;");
		expect(
			roomUses([
				room,
				{
					...point("n1", { door: "yes" }),
					properties: {
						"@id": "n1",
						"@lv": ";0;",
						"@kind": "door",
						door: "yes",
					},
				},
				point("n2", { shop: "books" }, ";0;", [5, 5]),
				point("n3", { amenity: "cafe" }, ";1;"),
			]).size,
		).toBe(0);
		expect(roomUses([room, point("n4", { amenity: "cafe" }, ";0;")])).toEqual(
			new Map([["w1", "food"]]),
		);
	});

	it("doesn't let small things make an area theirs, but they still make a room", () => {
		const atm = point("n1", { amenity: "atm" });
		expect(
			roomUses([square("w1", { indoor: "area", "@kind": "area" }), atm]).size,
		).toBe(0);
		expect(roomUses([square("w2", { indoor: "room" }), atm])).toEqual(
			new Map([["w2", "service"]]),
		);
	});

	it("never tints corridors, and a platform stays a platform with a shop on it", () => {
		const shop = point("n1", { shop: "kiosk" });
		expect(
			roomUses([
				square("w1", { indoor: "corridor", "@kind": "space" }),
				square("w2", { indoor: "area", "@kind": "space", railway: "platform" }),
				point("n2", { shop: "books" }),
				shop,
			]),
		).toEqual(new Map([["w2", "platform"]]));
	});
});
