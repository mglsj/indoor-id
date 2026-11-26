import { describe, expect, it } from "vitest";
import { loadPresetIndex } from "./load.ts";

const index = await loadPresetIndex();

/** Checks the presets generated from iD's schema cover Simple Indoor Tagging. */
describe("generated presets", () => {
	it.each([
		[{ indoor: "room" }, "area", "Room"],
		[
			{ indoor: "room", stairs: "yes", level: "0;1" },
			"area",
			"Indoor Stairwell",
		],
		[{ indoor: "room", elevator: "yes" }, "area", "Indoor Elevator Shaft"],
		[{ indoor: "corridor" }, "area", "Indoor Corridor"],
		[{ indoor: "area" }, "area", "Indoor Area"],
		[{ indoor: "level", level: "1" }, "area", "Indoor Level Outline"],
		[{ indoor: "wall" }, "line", "Indoor Wall"],
		[{ door: "hinged" }, "vertex", "Door"],
		[{ entrance: "main" }, "vertex", "Main Entrance"],
		[{ highway: "elevator" }, "vertex", "Elevator"],
		[{ indoor: "room", amenity: "toilets" }, "area", "Restroom"],
		// As osm-simple3d-editor writes them (presets/indoor-conventions.ts).
		[
			{ indoor: "room", room: "toilets", amenity: "toilets" },
			"area",
			"Restroom",
		],
		[
			{ highway: "steps", indoor: "yes", incline: "up", level: "0;1" },
			"line",
			"Steps",
		],
		// The 2026-11-26 conventions audit (SIT and the Indoor OSM Workshop 2026).
		[
			{ indoor: "room", room: "stairs", stairs: "yes", level: "0;1" },
			"area",
			"Indoor Stairwell",
		],
		[{ indoor: "room", room: "stairs" }, "area", "Staircase"],
		[
			{ indoor: "area", room: "stairs", stairs: "yes" },
			"area",
			"Open Staircase",
		],
		[
			{ indoor: "room", elevator: "yes", highway: "elevator" },
			"area",
			"Indoor Elevator Shaft",
		],
		[{ "area:highway": "steps", level: "0;1" }, "area", "Stairs Outline"],
		[{ barrier: "step", level: "0" }, "vertex", "Step"],
		[{ window: "yes", level: "1" }, "vertex", "Window"],
		[{ indoor: "column", level: "0" }, "point", "Indoor Column"],
		[{ indoor: "column", level: "0" }, "area", "Indoor Column"],
		[{ indoor: "room", room: "classroom" }, "point", "Room"],
	] as const)("names %j (%s) %j", (tags, geometry, name) => {
		expect(index.match(tags, geometry).name).toBe(name);
	});

	it("writes both forms of a staircase and SIT's elevator shaft (2026-11-26 audit)", () => {
		expect(index.preset("indoor/stairs")?.addTags).toEqual({
			indoor: "room",
			room: "stairs",
			stairs: "yes",
		});
		expect(index.preset("indoor/stairs_open")?.addTags).toEqual({
			indoor: "area",
			room: "stairs",
			stairs: "yes",
		});
		expect(index.preset("indoor/elevator")?.addTags).toEqual({
			indoor: "room",
			elevator: "yes",
			highway: "elevator",
		});
	});

	it("offers colour, material and the level's displayed name on doors and walls", () => {
		const more = (id: string) => index.preset(id)?.moreFields ?? [];
		for (const id of ["door", "indoor/door", "entrance"]) {
			expect(more(id)).toEqual(
				expect.arrayContaining(["level_ref", "colour", "material"]),
			);
		}
		expect(more("entrance")).toEqual(
			expect.arrayContaining(["width", "height"]),
		);
		expect(more("indoor/wall")).toEqual(
			expect.arrayContaining(["width", "colour", "material"]),
		);
		for (const id of ["indoor/room", "indoor/area", "indoor/corridor"]) {
			expect(more(id)).toContain("level_ref");
		}
	});

	it("has the indoor fields, with labels", () => {
		const { fields } = index.fieldsOf(index.match({ indoor: "room" }, "area"));
		expect(fields.map((f) => f.key)).toEqual(
			expect.arrayContaining(["level", "name", "ref"]),
		);
		expect(fields.find((f) => f.key === "level")?.label).toBe("Level");
	});

	it("finds rooms by name", () => {
		expect(index.search("room", "area")[0]?.name).toBe("Room");
	});

	it("keeps the option labels and descriptions of the schema's English strings", () => {
		expect(index.field("shop")?.options).toContainEqual({
			value: "beauty",
			label: "Beauty Shop",
		});
		expect(index.field("access")?.options).toContainEqual({
			value: "yes",
			label: "Allowed",
			description: "Access allowed by law; a right of way",
		});
	});

	it("keeps what fields need to edit tags as iD does", () => {
		expect(index.field("opening_hours")).toMatchObject({
			snakeCase: false,
			caseSensitive: true,
		});
		expect(index.field("shop")).toMatchObject({
			snakeCase: true,
			caseSensitive: false,
			customValues: true,
		});
		expect(index.field("siren/type")).toMatchObject({
			customValues: false,
			autoSuggestions: false,
		});
		expect(index.field("hoops")).toMatchObject({ minValue: 0 });
		expect(index.field("building_area_yes")).toMatchObject({
			default: "yes",
			geometry: ["area"],
		});
		expect(index.field("address")?.reference).toEqual({ key: "addr:*" });
		expect(index.field("level")).toMatchObject({
			prerequisiteTag: { keyNot: "building" },
			terms: expect.arrayContaining(["storey"]),
		});
	});

	it("has the universal fields, even those no indoor preset lists", () => {
		const universal = index.universalFields().map((f) => f.id);
		expect(universal).toEqual(
			expect.arrayContaining(["name", "description", "note", "fixme"]),
		);
		expect(universal).toContain("panoramax");
		expect(universal).not.toContain("level");
		expect(index.field("note")?.universal).toBe(true);
		expect(index.field("level")?.universal).toBe(false);
	});

	it("has the preset categories, with the presets they hold", () => {
		const building = index
			.categories()
			.find((c) => c.id === "category-building");
		expect(building).toMatchObject({
			name: "Building Features",
			icon: "maki-building",
		});
		expect(building?.members.map((p) => p.id)).toEqual([
			"building",
			"building/house",
			"building/apartments",
			"building/garage",
			"building/retail",
			"building/commercial",
			"building/industrial",
			"building/residential",
		]);
	});
});
