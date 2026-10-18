import { describe, expect, it } from "vitest";
import { loadPresetIndex } from "./load.ts";

/** Checks the presets generated from iD's schema cover Simple Indoor Tagging. */
describe("generated presets", async () => {
	const index = await loadPresetIndex();

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
	] as const)("names %j (%s) %j", (tags, geometry, name) => {
		expect(index.match(tags, geometry).name).toBe(name);
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
