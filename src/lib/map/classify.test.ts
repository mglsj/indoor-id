import { describe, expect, it } from "vitest";
import {
	arrowOf,
	classify,
	doorWidth,
	entranceLabel,
	iconFor,
	labelFor,
	trackGauge,
} from "./classify.ts";

describe("classify", () => {
	it.each([
		[{ indoor: "room" }, "Polygon", "room"],
		[{ indoor: "room", stairs: "yes" }, "Polygon", "vertical"],
		[{ indoor: "room", elevator: "yes" }, "Polygon", "vertical"],
		[{ highway: "elevator" }, "Polygon", "vertical"],
		[{ room: "stairs" }, "Polygon", "vertical"],
		[{ room: "office" }, "Polygon", "room"],
		[{ buildingpart: "room" }, "Polygon", "room"],
		[{ indoor: "area" }, "Polygon", "space"],
		[{ indoor: "corridor" }, "Polygon", "space"],
		[{ indoor: "level", level: "0" }, "Polygon", "space"],
		[{ room: "corridor" }, "Polygon", "space"],
		[{ public_transport: "platform" }, "Polygon", "space"],
		[{ indoor: "wall" }, "LineString", "wall"],
		[{ indoor: "wall", area: "yes" }, "Polygon", "wall"],
		[{ indoor: "column" }, "Polygon", "column"],
		[{ man_made: "pillar" }, "Point", "column"],
		[{ building: "yes" }, "Polygon", "building"],
		[{ "building:part": "yes" }, "Polygon", "building"],
		[{ "building:part": "yes", indoor: "yes", level: "1" }, "Polygon", "area"],
		[{ "building:part": "yes", indoor: "corridor" }, "Polygon", "space"],
		[{ "building:part": "yes", indoor: "no" }, "Polygon", "building"],
		[{ door: "hinged" }, "Point", "door"],
		[{ entrance: "main" }, "Point", "door"],
		[{ door: "no" }, "Point", "passage"],
		[{ door: "hinged" }, "LineString", "door"],
		[{ highway: "corridor" }, "LineString", "path"],
		[{ highway: "steps" }, "LineString", "path"],
		[{ amenity: "toilets" }, "Point", "poi"],
		[{ amenity: "toilets", indoor: "room" }, "Polygon", "room"],
		[{ barrier: "fence" }, "LineString", "line"],
		[{ barrier: "fence", level: "0" }, "LineString", "railing"],
		[{ barrier: "fence", indoor: "yes" }, "LineString", "railing"],
		[{ barrier: "turnstile", level: "-1" }, "Point", "door"],
		[{ barrier: "gate", indoor: "yes" }, "Point", "door"],
		[{ barrier: "turnstile" }, "Point", "poi"],
		[{ barrier: "bollard", level: "0" }, "Point", "poi"],
		[{ landuse: "retail" }, "Polygon", "area"],
		// SIT: indoor=* is the kind of space; room=* only says what it is for.
		[{ indoor: "area", room: "toilets" }, "Polygon", "space"],
		[{ indoor: "corridor", room: "office" }, "Polygon", "space"],
		[{ indoor: "room", room: "corridor" }, "Polygon", "room"],
		[{ indoor: "yes", room: "office" }, "Polygon", "room"],
		[{ building: "no", amenity: "parking" }, "Polygon", "area"],
	] as const)("%j as %s is a %s", (tags, geometry, kind) => {
		expect(classify(tags, geometry)).toBe(kind);
	});
});

describe("iconFor", () => {
	const available = new Set([
		"amenity_toilets",
		"shop_bakery",
		"room_auditorium",
		"room_toilets",
		"highway_elevator",
		"highway_steps",
		"passage_escalator",
	]);

	it.each([
		[{ amenity: "toilets" }, "amenity_toilets"],
		[{ shop: "bakery", level: "0" }, "shop_bakery"],
		[{ indoor: "room", room: "toilets" }, "room_toilets"],
		[{ indoor: "room", room: "amphitheatre" }, "room_auditorium"],
		[{ indoor: "room", stairs: "yes" }, "highway_steps"],
		[{ indoor: "room", elevator: "yes" }, "highway_elevator"],
		[{ highway: "elevator" }, "highway_elevator"],
		[{ conveying: "forward", highway: "steps" }, "passage_escalator"],
		[{ indoor: "room", amenity: "toilets" }, "amenity_toilets"],
	])("gives %j the icon %s", (tags, icon) => {
		expect(iconFor(tags, available)).toBe(icon);
	});

	it("gives no icon when none is available", () => {
		expect(iconFor({ amenity: "fountain" }, available)).toBeNull();
		expect(iconFor({ indoor: "room" }, available)).toBeNull();
	});

	describe("with the feature's preset", () => {
		const withPresetIcons = new Set([
			...available,
			"maki-toilet",
			"temaki-room",
			"temaki-elevator",
			"maki-entrance-alt1",
		]);

		it("prefers the preset's icon", () => {
			expect(
				iconFor({ amenity: "toilets" }, withPresetIcons, {
					id: "amenity/toilets",
					icon: "maki-toilet",
				}),
			).toBe("maki-toilet");
			expect(
				iconFor({ indoor: "room", elevator: "yes" }, withPresetIcons, {
					id: "indoor/elevator",
					icon: "temaki-elevator",
				}),
			).toBe("temaki-elevator");
		});

		it("falls back to the OsmInEdit icons when the preset's icon is not bundled", () => {
			expect(
				iconFor({ indoor: "room", stairs: "yes" }, withPresetIcons, {
					id: "indoor/stairs",
					icon: "iD-highway-steps",
				}),
			).toBe("highway_steps");
			expect(
				iconFor({ amenity: "toilets" }, withPresetIcons, {
					id: "amenity/toilets",
				}),
			).toBe("amenity_toilets");
		});

		it.each([
			["indoor/room", "temaki-room"],
			["indoor/level", "temaki-room"],
			["door", "maki-entrance-alt1"],
			["entrance/main", "maki-entrance-alt1"],
		])("draws no icon for structure: %s", (id, icon) => {
			expect(
				iconFor({ indoor: "room" }, withPresetIcons, { id, icon }),
			).toBeNull();
		});
	});
});

describe("labelFor", () => {
	it("prefers the name, then the ref (room number)", () => {
		expect(labelFor({ name: "Library", ref: "B12" })).toBe("Library");
		expect(labelFor({ indoor: "room", ref: "B12" })).toBe("B12");
		expect(labelFor({ indoor: "room" })).toBeNull();
	});
});

describe("arrowOf", () => {
	it("points steps and ramps up the way, escalators the way they move", () => {
		expect(arrowOf({ highway: "steps", incline: "up" })).toBe("forward");
		expect(arrowOf({ highway: "steps", incline: "down" })).toBe("backward");
		expect(arrowOf({ highway: "footway", incline: "-8%" })).toBe("backward");
		expect(arrowOf({ highway: "footway", incline: "5°" })).toBe("forward");
		expect(arrowOf({ conveying: "backward", incline: "up" })).toBe("backward");
		expect(arrowOf({ conveying: "reversible" })).toBe("both");
	});

	it("has no arrow without a direction", () => {
		expect(arrowOf({ highway: "steps" })).toBeNull();
		expect(arrowOf({ incline: "yes" })).toBeNull();
		expect(arrowOf({ incline: "0%" })).toBeNull();
	});
});

describe("doorWidth", () => {
	it("reads metres, centimetres and feet", () => {
		expect(doorWidth({ width: "0.9" })).toBe(0.9);
		expect(doorWidth({ width: "1.2 m" })).toBe(1.2);
		expect(doorWidth({ width: "90 cm" })).toBe(0.9);
		expect(doorWidth({ width: "3'" })).toBeCloseTo(0.9144, 6);
	});

	it("reads a decimal comma, and feet with inches", () => {
		expect(doorWidth({ width: "0,9" })).toBe(0.9);
		expect(doorWidth({ width: "3'6\"" })).toBeCloseTo(1.0668, 6);
		expect(doorWidth({ width: '36"' })).toBeCloseTo(0.9144, 6);
	});

	it("ignores what it can't read, or isn't a door's size", () => {
		expect(doorWidth({})).toBeNull();
		expect(doorWidth({ width: "wide" })).toBeNull();
		expect(doorWidth({ width: "0.1" })).toBeNull();
		expect(doorWidth({ width: "90" })).toBeNull();
	});
});

describe("trackGauge", () => {
	it("reads a track's gauge in metres, standard gauge when unknown", () => {
		expect(trackGauge({ railway: "rail", gauge: "1000" })).toBe(1);
		expect(trackGauge({ railway: "subway", gauge: "1435;1000" })).toBe(1.435);
		expect(trackGauge({ railway: "tram" })).toBe(1.435);
		expect(trackGauge({ railway: "rail", gauge: "standard" })).toBe(1.435);
		expect(trackGauge({ railway: "platform" })).toBeNull();
		expect(trackGauge({ highway: "footway" })).toBeNull();
	});
});

describe("entranceLabel (P6, the viewer)", () => {
	it.each([
		[{ entrance: "staircase", ref: "3", "addr:flats": "1-36" }, "3\n1–36"],
		[{ entrance: "yes", "addr:flats": "37-72;80" }, "37–72, 80"],
		[{ entrance: "main", ref: "A" }, "A"],
		[{ entrance: "main", name: "North", ref: "A" }, "North"],
	])("labels %j %j", (tags, label) => {
		expect(entranceLabel(tags)).toBe(label);
	});

	it("labels only entrances that say something", () => {
		expect(entranceLabel({ entrance: "yes" })).toBeNull();
		expect(entranceLabel({ door: "yes", ref: "101" })).toBeNull();
	});
});
