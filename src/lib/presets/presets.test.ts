import { describe, expect, it } from "vitest";
import {
	type Preset,
	type Field as PresetField,
	type PresetGeometry,
	PresetIndex,
} from "./presets.ts";

const preset = (
	id: string,
	name: string,
	geometry: PresetGeometry[],
	tags: Record<string, string>,
	extra: Partial<Preset> = {},
): Preset => ({
	id,
	name,
	terms: [],
	geometry,
	tags,
	fields: [],
	moreFields: [],
	...extra,
});

const index = new PresetIndex(
	[
		preset("point", "Point", ["point", "vertex"], {}, { matchScore: 0.1 }),
		preset("line", "Line", ["line"], {}, { matchScore: 0.1 }),
		preset("area", "Area", ["area"], { area: "yes" }, { matchScore: 0.1 }),
		preset(
			"indoor",
			"Indoor Feature",
			["point", "vertex", "line", "area"],
			{ indoor: "*" },
			{
				matchScore: 0.8,
				searchable: false,
			},
		),
		preset(
			"indoor/room",
			"Room",
			["area"],
			{ indoor: "room" },
			{
				matchScore: 0.8,
				terms: ["lobby", "chamber"],
			},
		),
		preset(
			"indoor/stairs",
			"Indoor Stairwell",
			["area"],
			{ indoor: "room", stairs: "yes" },
			{
				matchScore: 0.8,
			},
		),
		preset("amenity/toilets", "Toilets", ["point", "vertex", "area"], {
			amenity: "toilets",
		}),
		preset("entrance", "Entrance/Exit", ["vertex"], { entrance: "*" }),
		preset("highway/steps", "Steps", ["line"], { highway: "steps" }),
	],
	[],
);

describe("PresetIndex.match", () => {
	it.each([
		[{ indoor: "room" }, "area", "indoor/room"],
		[{ indoor: "room", stairs: "yes", level: "0;1" }, "area", "indoor/stairs"],
		[{ indoor: "room", amenity: "toilets" }, "area", "amenity/toilets"],
		[{ indoor: "corridor" }, "area", "indoor"],
		[{ amenity: "toilets" }, "vertex", "amenity/toilets"],
		[{ entrance: "main" }, "vertex", "entrance"],
		[{ entrance: "main" }, "point", "point"],
		[{ highway: "steps" }, "line", "highway/steps"],
		[{ highway: "steps" }, "area", "area"],
		[{}, "line", "line"],
	] as const)("matches %j as a %s with %s", (tags, geometry, id) => {
		expect(index.match(tags, geometry).id).toBe(id);
	});
});

describe("PresetIndex.search, ranked as iD does", () => {
	const fallbacks = [
		preset("point", "Point", ["point", "vertex"], {}, { matchScore: 0.1 }),
		preset("area", "Area", ["area"], { area: "yes" }, { matchScore: 0.1 }),
	];
	const search = new PresetIndex(
		[
			...fallbacks,
			preset("amenity/toilets", "Toilets", ["point", "area"], {
				amenity: "toilets",
			}),
			preset(
				"amenity/toilets/public",
				"Public Toilets",
				["point", "area"],
				{ amenity: "toilets", access: "yes" },
				{ aliases: ["Comfort Station"] },
			),
			preset("amenity/cafe", "Café", ["point", "area"], {
				amenity: "cafe",
			}),
			preset("amenity/cafeteria", "Cafeteria", ["point", "area"], {
				amenity: "cafeteria",
			}),
			preset(
				"room/restroom",
				"Restroom",
				["area"],
				{ room: "restroom" },
				{ terms: ["wc", "lavatory"] },
			),
			preset("amenity/washroom", "Washroom", ["area"], { amenity: "wc" }),
			preset(
				"hidden",
				"Toilet Block",
				["area"],
				{ hidden: "yes" },
				{
					searchable: false,
				},
			),
			preset("highway/steps", "Steps", ["line"], { highway: "steps" }),
		],
		[],
	);
	const names = (query: string, geometry: PresetGeometry = "area") =>
		search.search(query, geometry).map((p) => p.name);

	it("lists names starting with the query first, an exact name before the others", () => {
		expect(names("toilets")).toEqual(["Toilets", "Public Toilets", "Area"]);
		expect(names("toi").slice(0, 2)).toEqual(["Toilets", "Public Toilets"]);
	});

	it("finds names by their aliases", () => {
		expect(names("comfort")[0]).toBe("Public Toilets");
	});

	it("then names once accents are taken off", () => {
		expect(names("cafe").slice(0, 2)).toEqual(["Cafeteria", "Café"]);
	});

	it("then search terms, then tag values", () => {
		// (Then, as in iD, short names a few letters away: "Café", "Area".)
		expect(names("wc").slice(0, 2)).toEqual(["Restroom", "Washroom"]);
	});

	it("then names a typo or two away", () => {
		expect(names("toilts")[0]).toBe("Toilets");
	});

	it("matches key=value", () => {
		expect(names("amenity=toilets")).toEqual(
			expect.arrayContaining(["Toilets", "Public Toilets"]),
		);
	});

	it("finds a preset whose name is in the query", () => {
		expect(names("toilets on level 2")[0]).toBe("Toilets");
	});

	it("ends with the generic type, and leaves out other geometries and unsearchable presets", () => {
		expect(names("escalator")).toEqual(["Area"]);
		expect(names("toilet block")).not.toContain("Toilet Block");
		expect(names("toilets", "point").at(-1)).toBe("Point");
	});

	it("returns nothing for an empty query", () => {
		expect(names(" ")).toEqual([]);
	});
});

describe("PresetIndex.listFor (before a search)", () => {
	const list = new PresetIndex(
		[
			preset("point", "Point", ["point", "vertex"], {}),
			preset("area", "Area", ["area"], { area: "yes" }),
			preset("indoor/room", "Room", ["area"], { indoor: "room" }),
			preset("indoor/corridor", "Indoor Corridor", ["area"], {
				indoor: "corridor",
			}),
			preset("amenity/toilets", "Toilets", ["point", "area"], {
				amenity: "toilets",
			}),
			preset("building", "Building", ["area"], { building: "*" }),
			preset("building/house", "House", ["area"], { building: "house" }),
			preset("shop/bakery", "Bakery", ["point", "area"], { shop: "bakery" }),
			preset("highway/steps", "Steps", ["line"], { highway: "steps" }),
		],
		[],
		[
			{
				id: "category-building",
				name: "Building Features",
				members: ["building", "building/house"],
			},
		],
	);
	const ids = (geometry: PresetGeometry, recent: string[], current?: string) =>
		list
			.listFor(geometry, recent, current ? list.preset(current) : undefined)
			.map((item) => item.id);

	it("lists recent types, the indoor defaults, the categories, then the generic type", () => {
		expect(
			ids("area", ["shop/bakery", "highway/steps", "indoor/room"]),
		).toEqual([
			"shop/bakery",
			"indoor/room",
			"indoor/corridor",
			"amenity/toilets",
			"category-building",
			"area",
		]);
	});

	it("adds the feature's current type when the list doesn't have it", () => {
		expect(ids("area", [], "building/house")).toEqual([
			"indoor/room",
			"indoor/corridor",
			"amenity/toilets",
			"category-building",
			"area",
			"building/house",
		]);
	});
});

describe("PresetIndex.changePreset, as iD's actionChangePreset", () => {
	const field = (
		id: string,
		key: string,
		extra: Partial<PresetField> = {},
	): PresetField => ({
		id,
		key,
		type: "text",
		label: id,
		options: [],
		terms: [],
		universal: false,
		snakeCase: true,
		caseSensitive: false,
		customValues: true,
		autoSuggestions: true,
		allowDuplicates: false,
		...extra,
	});
	const presets = new PresetIndex(
		[
			preset("area", "Area", ["area"], { area: "yes" }, { matchScore: 0.1 }),
			preset(
				"indoor/room",
				"Room",
				["area"],
				{ indoor: "room" },
				{
					fields: ["name", "level"],
				},
			),
			preset(
				"indoor/corridor",
				"Corridor",
				["area"],
				{ indoor: "corridor" },
				{
					fields: ["name", "level"],
				},
			),
			preset(
				"indoor/area",
				"Indoor Area",
				["area"],
				{ indoor: "area" },
				{
					fields: ["name", "min_level", "max_level"],
				},
			),
			preset(
				"shop/bakery",
				"Bakery",
				["point", "area"],
				{ shop: "bakery" },
				{
					fields: ["name", "opening_hours"],
				},
			),
			preset(
				"amenity/toilets",
				"Toilets",
				["point", "area"],
				{
					amenity: "toilets",
				},
				{ fields: ["name", "fee"] },
			),
			preset(
				"building",
				"Building",
				["area"],
				{ building: "*" },
				{
					fields: ["building_levels"],
				},
			),
			preset(
				"amenity/school",
				"School",
				["area"],
				{ amenity: "school" },
				{
					fields: ["name", "building_area"],
				},
			),
			preset(
				"amenity/restaurant",
				"Restaurant",
				["area"],
				{
					amenity: "restaurant",
				},
				{ fields: ["name", "cuisine"] },
			),
			preset(
				"amenity/restaurant/pizza",
				"Pizza Restaurant",
				["area"],
				{
					amenity: "restaurant",
					cuisine: "pizza",
				},
				{ fields: ["name", "cuisine"] },
			),
			preset("barrier/wall", "Wall", ["line", "area"], { barrier: "wall" }),
			preset("indoor", "Indoor Feature", ["point", "area"], { indoor: "*" }),
			preset(
				"indoor/level",
				"Level Outline",
				["area"],
				{ indoor: "level" },
				{
					fields: ["building_area"],
				},
			),
		],
		[
			field("name", "name"),
			field("level", "level"),
			field("min_level", "min_level"),
			field("max_level", "max_level"),
			field("opening_hours", "opening_hours"),
			field("fee", "fee"),
			field("building_levels", "building:levels"),
			field("cuisine", "cuisine"),
			field("building_area", "building", {
				default: "yes",
				geometry: ["area"],
			}),
		],
	);
	const change = (tags: Record<string, string>, from: string, to: string) =>
		presets.changePreset(
			tags,
			presets.preset(from),
			presets.preset(to),
			"area",
		);

	it("swaps the old type's tags for the new one's, keeping the rest", () => {
		expect(
			change(
				{ indoor: "room", level: "0", name: "Hall", ref: "1" },
				"indoor/room",
				"indoor/corridor",
			),
		).toEqual({ indoor: "corridor", level: "0", name: "Hall", ref: "1" });
	});

	it("keeps every level key, min_level and max_level too, even from a field", () => {
		expect(
			change(
				{ indoor: "area", min_level: "0", max_level: "2" },
				"indoor/area",
				"amenity/toilets",
			),
		).toEqual({ amenity: "toilets", min_level: "0", max_level: "2" });
	});

	it("drops values of the old type's fields the new type has no field for", () => {
		expect(
			change(
				{ shop: "bakery", name: "Paul", opening_hours: "Mo-Fr 08:00-18:00" },
				"shop/bakery",
				"amenity/toilets",
			),
		).toEqual({ amenity: "toilets", name: "Paul" });
	});

	it("keeps them when the old type still matches the result (a building becoming a school)", () => {
		expect(
			change(
				{ building: "yes", "building:levels": "3" },
				"building",
				"amenity/school",
			),
		).toEqual({ building: "yes", "building:levels": "3", amenity: "school" });
	});

	it("drops the tags of a sub-type when going to its parent", () => {
		expect(
			change(
				{ amenity: "restaurant", cuisine: "pizza", name: "Roma" },
				"amenity/restaurant/pizza",
				"amenity/restaurant",
			),
		).toEqual({ amenity: "restaurant", name: "Roma" });
	});

	it("sets yes for a type taking any value, and area=yes for one that can also be a line", () => {
		expect(change({ area: "yes" }, "area", "indoor")).toEqual({
			indoor: "yes",
		});
		expect(change({ area: "yes" }, "area", "barrier/wall")).toEqual({
			barrier: "wall",
			area: "yes",
		});
	});

	it("sets the new type's field defaults, and takes the old type's off", () => {
		expect(change({ area: "yes" }, "area", "amenity/school")).toEqual({
			amenity: "school",
			building: "yes",
		});
		expect(
			change(
				{ amenity: "school", building: "yes" },
				"amenity/school",
				"shop/bakery",
			),
		).toEqual({ shop: "bakery" });
	});

	// IndoorID's own rules, for features inside buildings.
	it("keeps level, level:ref and repeat_on, even when the new type has no field for them", () => {
		expect(
			change(
				{ shop: "bakery", level: "0", "level:ref": "G", repeat_on: "1" },
				"shop/bakery",
				"amenity/toilets",
			),
		).toEqual({
			amenity: "toilets",
			level: "0",
			"level:ref": "G",
			repeat_on: "1",
		});
	});

	it("doesn't make an indoor feature a building", () => {
		expect(
			change({ indoor: "room", level: "0" }, "indoor/room", "amenity/school"),
		).toEqual({ amenity: "school", level: "0" });
		expect(
			change({ area: "yes", level: "1" }, "area", "amenity/school"),
		).toEqual({ amenity: "school", level: "1" });
		expect(change({ area: "yes" }, "area", "indoor/level")).toEqual({
			indoor: "level",
		});
	});
});
