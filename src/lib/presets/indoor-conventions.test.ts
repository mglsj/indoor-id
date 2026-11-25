import { describe, expect, it } from "vitest";
import {
	asFlight,
	roomValueOf,
	withRoomPurpose,
} from "./indoor-conventions.ts";

describe("roomValueOf (osm-simple3d-editor's Purpose hint)", () => {
	it("gives the room value of a purpose", () => {
		expect(roomValueOf({ amenity: "toilets" })).toBe("toilets");
		expect(roomValueOf({ amenity: "fast_food" })).toBe("restaurant");
		expect(roomValueOf({ amenity: "pub" })).toBe("bar");
		expect(roomValueOf({ amenity: "ice_cream" })).toBe("cafe");
		expect(roomValueOf({ amenity: "pharmacy" })).toBe("pharmacy");
		expect(roomValueOf({ healthcare: "dentist" })).toBe("medical");
		expect(roomValueOf({ shop: "clothes" })).toBe("shop");
		expect(roomValueOf({ amenity: "atm" })).toBe("shop");
		expect(roomValueOf({ office: "company" })).toBe("office");
		expect(roomValueOf({ amenity: "library" })).toBe("library");
		expect(roomValueOf({ amenity: "school" })).toBe("class");
		expect(roomValueOf({ amenity: "parking" })).toBe("parking");
		expect(roomValueOf({ amenity: "bench" })).toBeUndefined();
	});
});

describe("withRoomPurpose", () => {
	it("makes a restroom area a room for toilets", () => {
		expect(
			withRoomPurpose({ amenity: "toilets", area: "yes", level: "0" }),
		).toEqual({
			amenity: "toilets",
			area: "yes",
			level: "0",
			indoor: "room",
			room: "toilets",
		});
	});

	it("keeps the indoor and room values there", () => {
		expect(
			withRoomPurpose({ amenity: "toilets", indoor: "area", level: "0" }),
		).toEqual({
			amenity: "toilets",
			indoor: "area",
			level: "0",
			room: "toilets",
		});
		expect(
			withRoomPurpose({ shop: "bakery", indoor: "room", room: "kitchen" }),
		).toEqual({ shop: "bakery", indoor: "room", room: "kitchen" });
	});

	it("makes a room without a room value for a purpose it has no value for", () => {
		expect(withRoomPurpose({ amenity: "bench", level: "0" })).toEqual({
			amenity: "bench",
			level: "0",
			indoor: "room",
		});
	});

	it("leaves features without a purpose, buildings and walls alone", () => {
		const plain = { indoor: "corridor", level: "0" };
		expect(withRoomPurpose(plain)).toBe(plain);
		const building = { building: "yes", amenity: "toilets" };
		expect(withRoomPurpose(building)).toBe(building);
		const wall = { indoor: "wall", amenity: "toilets" };
		expect(withRoomPurpose(wall)).toBe(wall);
	});
});

describe("asFlight", () => {
	const levels = [-1, 0, 1, 2];

	it("makes Steps on one level a flight up to the next level", () => {
		expect(asFlight({ highway: "steps", level: "0" }, levels)).toEqual({
			highway: "steps",
			indoor: "yes",
			level: "0;1",
			incline: "up",
		});
		expect(asFlight({ highway: "steps", level: "-1" }, levels)).toMatchObject({
			level: "-1;0",
			incline: "up",
		});
	});

	it("goes down from the top level", () => {
		expect(asFlight({ highway: "steps", level: "2" }, levels)).toMatchObject({
			level: "1;2",
			incline: "down",
		});
	});

	it("goes up one level when the building has no other", () => {
		expect(asFlight({ highway: "steps", level: "0" }, [0])).toMatchObject({
			level: "0;1",
			incline: "up",
		});
	});

	it("keeps levels and incline set already, and leaves escalators alone", () => {
		expect(
			asFlight({ highway: "steps", level: "0;1", incline: "down" }, levels),
		).toEqual({
			highway: "steps",
			level: "0;1",
			incline: "down",
			indoor: "yes",
		});
		const escalator = { highway: "steps", conveying: "yes", level: "0" };
		expect(asFlight(escalator, levels)).toBe(escalator);
	});
});
