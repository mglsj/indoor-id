import { describe, expect, it } from "vitest";
import { msg } from "#lib/i18n/messages.ts";
import type { Entity, EntityId } from "#lib/osm/entity.ts";
import { node, relation, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { LOCAL_UPGRADES, type UpgradeRule, upgradeTags } from "./upgrades.ts";
import { type IssueRule, validate } from "./validate.ts";

/** A few rules in the format of iD's deprecated.json. */
const SCHEMA: UpgradeRule[] = [
	{ old: { diaper: "yes" }, replace: { changing_table: "yes" } },
	{ old: { "building:height": "*" }, replace: { height: "$1" } },
	{ old: { "fixme:type": "*" } },
];
const RULES = [...SCHEMA, ...LOCAL_UPGRADES];

/** A room way around three untagged nodes, with the given tags. */
function roomWith(tags: Record<string, string>): Entity[] {
	return [
		node("n1", {}, [0, 0]),
		node("n2", {}, [0.0001, 0]),
		node("n3", {}, [0, 0.0001]),
		way("w1", ["n1", "n2", "n3", "n1"], tags),
	];
}

/** W3's rules, tested in recheck.test.ts and buildings.test.ts: the fixtures here aren't joined. */
const W3: ReadonlySet<IssueRule> = new Set([
	"wall-twice",
	"jitter",
	"door-on-side",
	"building-overlap",
	"building-inside",
	"unglued-wall",
]);

function issuesOf(entities: Entity[], id: EntityId) {
	return validate(Graph.fromEntities(entities), [id], RULES).filter(
		(i) => !W3.has(i.rule),
	);
}

/** Tags of the entity after applying the first issue's fix. */
function fixed(entities: Entity[], id: EntityId) {
	const graph = Graph.fromEntities(entities);
	const [issue] = validate(graph, [id], RULES);
	if (!issue?.fix) throw new Error("No fix");
	return issue.fix.action(graph).entity(id)?.tags;
}

describe("upgradeTags", () => {
	it("replaces old tags, substituting $1 with the old value", () => {
		expect(upgradeTags({ "building:height": "12", name: "A" }, RULES)).toEqual({
			height: "12",
			name: "A",
		});
	});

	it("removes tags that have no replacement", () => {
		expect(upgradeTags({ "fixme:type": "x", indoor: "room" }, RULES)).toEqual({
			indoor: "room",
		});
	});

	it("leaves current tags alone", () => {
		const tags = { indoor: "room", room: "office", level: "0" };
		expect(upgradeTags(tags, RULES)).toBe(tags);
	});
});

describe("validate: outdated tags", () => {
	it.each([
		[{ room: "stairs" }, { indoor: "room", stairs: "yes" }],
		[
			{ room: "elevator" },
			{ indoor: "room", elevator: "yes", highway: "elevator" },
		],
		[
			{ buildingpart: "room", level: "1" },
			{ indoor: "room", level: "1" },
		],
		[{ buildingpart: "corridor" }, { indoor: "corridor" }],
		[{ buildingpart: "hall" }, { indoor: "area" }],
		[
			{
				buildingpart: "verticalpassage",
				"buildingpart:verticalpassage": "elevator",
			},
			{ indoor: "room", elevator: "yes", highway: "elevator" },
		],
		[
			{
				buildingpart: "verticalpassage",
				"buildingpart:verticalpassage": "stairway",
			},
			{ indoor: "room", stairs: "yes" },
		],
		[
			{ indoor: "highway", highway: "corridor" },
			{ indoor: "yes", highway: "corridor" },
		],
		[
			{ indoor: "stairs", highway: "steps" },
			{ indoor: "yes", highway: "steps" },
		],
		[{ indoor: "room", room: "column" }, { indoor: "column" }],
		[
			{ indoor: "area", room: "column", level: "0" },
			{ indoor: "column", level: "0" },
		],
		[{ door: "loadingdock" }, { door: "yes", amenity: "loading_dock" }],
		[{ entrance: "gate" }, { barrier: "gate" }],
		[
			{ "addr:entrance": "yes", door: "hinged" },
			{ entrance: "yes", door: "hinged" },
		],
		[
			{ indoor: "room", amenity: "toilets", diaper: "yes" },
			{ indoor: "room", amenity: "toilets", changing_table: "yes" },
		],
	])("upgrades %j to %j", (tags, expected) => {
		const entities = roomWith(tags);
		// Indoor features without a level have their own issue.
		const issues = issuesOf(entities, "w1").filter(
			(i) => i.rule !== "missing-level",
		);
		expect(issues).toMatchObject([{ rule: "outdated-tags", entityId: "w1" }]);
		expect(fixed(entities, "w1")).toEqual(expected);
	});

	it("has nothing to say about current tagging", () => {
		expect(
			issuesOf(roomWith({ indoor: "room", room: "office", level: "0" }), "w1"),
		).toEqual([]);
	});
});

describe("validate: levels", () => {
	it("flags a level it can't read, without guessing a fix", () => {
		const [issue, ...rest] = issuesOf(
			roomWith({ indoor: "room", level: "G" }),
			"w1",
		);
		expect(rest).toEqual([]);
		expect(issue).toMatchObject({ rule: "unreadable-level" });
		expect(issue?.fix).toBeUndefined();
	});

	it("flags a range too wide to be a building's, without guessing a fix", () => {
		const issues = issuesOf(
			roomWith({ indoor: "room", level: "0-10000000" }),
			"w1",
		);
		expect(issues).toMatchObject([{ rule: "implausible-level-range" }]);
		expect(issues[0]?.fix).toBeUndefined();
		expect(issues[0]?.message).toEqual(
			msg("issue_implausible_level_range", {
				key: "level",
				value: "0-10000000",
			}),
		);
	});

	it("explains a comma, which could be a list or a decimal", () => {
		const [issue] = issuesOf(roomWith({ indoor: "room", level: "1,5" }), "w1");
		expect(issue?.message).toEqual(
			msg("issue_unreadable_level_comma", { key: "level", value: "1,5" }),
		);
	});

	it("moves the levels of stairs and elevators from repeat_on to level", () => {
		const entities = roomWith({
			indoor: "room",
			stairs: "yes",
			level: "0",
			repeat_on: "1;2",
		});
		expect(issuesOf(entities, "w1")).toMatchObject([
			{ rule: "vertical-repeat-on" },
		]);
		expect(fixed(entities, "w1")).toEqual({
			indoor: "room",
			stairs: "yes",
			level: "0;1;2",
		});
	});

	it("knows a stairwell by room=stairs or buildingpart=verticalpassage too, as the map does (R4)", () => {
		const stairwells: Record<string, string>[] = [
			{ indoor: "room", room: "stairs" },
			{ indoor: "room", buildingpart: "verticalpassage" },
		];
		for (const tags of stairwells) {
			const rules = issuesOf(
				roomWith({ ...tags, level: "0", repeat_on: "1" }),
				"w1",
			).map((i) => i.rule);
			expect(rules).toContain("vertical-repeat-on");
		}
	});

	it("accepts repeat_on on an elevator's or stairs' door (SIT's vertical connections)", () => {
		const graph = Graph.fromEntities([
			node("n1", {
				door: "sliding",
				elevator: "yes",
				level: "0",
				repeat_on: "1;2",
			}),
			node("n2", {
				entrance: "yes",
				stairs: "yes",
				level: "0",
				repeat_on: "1",
			}),
		]);
		const rules = validate(graph, ["n1", "n2"], []).map((i) => i.rule);
		expect(rules).not.toContain("vertical-repeat-on");
	});

	it("accepts repeat_on on a point repeated on several levels (SIT: nodes only)", () => {
		const graph = Graph.fromEntities([
			node("n1", { amenity: "vending_machine", level: "0", repeat_on: "1;2" }),
		]);
		expect(validate(graph, ["n1"], [])).toEqual([]);
	});

	it("warns about repeat_on on a room: SIT lists it for nodes only (workshop 2026)", () => {
		const issues = issuesOf(
			roomWith({
				indoor: "room",
				amenity: "toilets",
				level: "0",
				repeat_on: "1;2",
			}),
			"w1",
		);
		expect(issues).toMatchObject([{ rule: "repeat-on-way" }]);
		expect(issues[0]?.fix).toBeUndefined();
	});

	it("flags level values out of order or repeated, and writes them in order on request", () => {
		// Indoor OSM Workshop 2026: `5-3` and `1;2;1` are read like `3-5` and `1;2`, but
		// validators warn about them.
		const cases: [string, string][] = [
			["5-3", "3-5"],
			["1;2;1", "1;2"],
			["2;0;1", "0;1;2"],
			["-1--2", "-2--1"],
		];
		for (const [value, expected] of cases) {
			const entities = roomWith({ indoor: "room", level: value });
			const unordered = issuesOf(entities, "w1").filter(
				(i) => i.rule === "unordered-level",
			);
			expect(unordered).toMatchObject([
				{
					rule: "unordered-level",
					message: msg("issue_unordered_level", {
						key: "level",
						value,
						expected,
					}),
				},
			]);
			expect(fixed(entities, "w1")).toEqual({
				indoor: "room",
				level: expected,
			});
		}
	});

	it("leaves level values already in order alone, spaces included", () => {
		for (const value of ["0", "-1;0", "0;1", "0-2", "0.5", "-2--1", "0; 1"]) {
			const rules = issuesOf(roomWith({ indoor: "room", level: value }), "w1");
			expect(rules.map((i) => i.rule)).not.toContain("unordered-level");
		}
	});
});

describe("validate: issue ids", () => {
	it("gives each issue its own id, also for two unreadable level keys", () => {
		const issues = issuesOf(
			roomWith({ indoor: "room", level: "G", repeat_on: "G" }),
			"w1",
		);
		const ids = issues
			.filter((i) => i.rule === "unreadable-level")
			.map((i) => i.id);
		expect(ids).toHaveLength(2);
		expect(new Set(ids).size).toBe(2);
	});
});

describe("validate: doors", () => {
	it("flags a door that is not on a wall or room outline", () => {
		expect(
			issuesOf([node("n9", { door: "hinged", level: "0" })], "n9"),
		).toMatchObject([{ rule: "door-not-on-wall", severity: "warning" }]);
	});

	it("accepts a door on a room outline", () => {
		const entities = [
			node("n1"),
			node("n2"),
			node("n9", { door: "hinged" }),
			way("w1", ["n1", "n9", "n2", "n1"], { indoor: "room" }),
		];
		expect(issuesOf(entities, "n9")).toEqual([]);
	});
});

it("only checks the entities asked for", () => {
	const graph = Graph.fromEntities([
		...roomWith({ indoor: "room", room: "stairs" }),
		node("n9", { door: "yes" }, [1, 1]),
	]);
	expect(validate(graph, ["n9"], RULES).map((i) => i.entityId)).toEqual(["n9"]);
	expect(validate(graph, ["w404"], RULES)).toEqual([]);
});

/** The rules of the issues of one tagged node, alone in the graph. */
function rulesOfNode(tags: Record<string, string>) {
	return issuesOf([node("n1", tags)], "n1").map((i) => i.rule);
}

describe("validate: indoor tagging (osm-simple3d-editor's checks)", () => {
	it("flags room=* on something that isn't a room, area or corridor", () => {
		const [issue] = issuesOf(roomWith({ room: "office", shop: "books" }), "w1");
		expect(issue).toMatchObject({ rule: "room-not-indoor" });
		expect(issue?.message).toEqual(
			msg("issue_room_not_indoor", { value: "office" }),
		);
		expect(fixed(roomWith({ room: "office", shop: "books" }), "w1")).toEqual({
			indoor: "room",
			room: "office",
			shop: "books",
		});
	});

	it.each(["room", "area", "corridor"])("accepts room=* on indoor=%s", (v) => {
		expect(
			issuesOf(roomWith({ indoor: v, room: "office", level: "0" }), "w1"),
		).toEqual([]);
	});

	it.each(["wall", "column"])(
		"explains room=* on indoor=%s, without a fix",
		(v) => {
			const [issue, ...rest] = issuesOf(
				roomWith({ indoor: v, room: "office", level: "0" }),
				"w1",
			);
			expect(rest).toEqual([]);
			expect(issue?.message).toEqual(
				msg("issue_room_on_wall", { indoor: v, value: "office" }),
			);
			expect(issue?.fix).toBeUndefined();
		},
	);

	it("keeps room=stairs and room=elevator on an indoor space, as osm-simple3d-editor writes them", () => {
		for (const tags of [
			{ indoor: "area", room: "stairs", level: "0;1" },
			{ indoor: "room", room: "elevator", level: "0;1" },
		]) {
			expect(upgradeTags(tags, RULES)).toBe(tags);
		}
	});

	it("leaves room=stairs and room=elevator to the upgrades", () => {
		const rules = issuesOf(roomWith({ room: "stairs" }), "w1").map(
			(i) => i.rule,
		);
		expect(rules).toEqual(["outdated-tags"]);
	});

	it("flags building:part on a room, area or corridor, but not on a level outline", () => {
		expect(
			issuesOf(
				roomWith({ indoor: "room", level: "0", "building:part": "yes" }),
				"w1",
			),
		).toMatchObject([{ rule: "building-part-indoor" }]);
		expect(
			issuesOf(
				roomWith({ indoor: "level", level: "0", "building:part": "yes" }),
				"w1",
			),
		).toEqual([]);
	});

	it("flags inside=*, which isn't an established key", () => {
		expect(rulesOfNode({ shop: "books", inside: "yes" })).toEqual([
			"unknown-inside",
		]);
	});

	it("adds door=yes to indoor=door without door=*", () => {
		const entities = [
			node("n1"),
			node("n2"),
			node("n9", { indoor: "door", level: "0" }),
			way("w1", ["n1", "n9", "n2", "n1"], { indoor: "room", level: "0" }),
		];
		expect(issuesOf(entities, "n9")).toMatchObject([
			{ rule: "door-without-type" },
		]);
		expect(fixed(entities, "n9")).toEqual({
			indoor: "door",
			door: "yes",
			level: "0",
		});
	});

	it("hints that a building passage, outdoors, has no level", () => {
		const [issue, ...rest] = issuesOf(
			[
				node("n1"),
				node("n2", {}, [0.0001, 0]),
				node("n3", {}, [0.0002, 0]),
				way("w1", ["n1", "n2"], {
					highway: "footway",
					tunnel: "building_passage",
					level: "0",
				}),
				way("w2", ["n2", "n3"], { highway: "footway" }),
			],
			"w1",
		);
		expect(rest).toEqual([]);
		expect(issue).toMatchObject({ rule: "building-passage-level" });
		expect(issue?.fix).toBeUndefined();
	});
});

describe("validate: openings on several levels", () => {
	/** A door on a wall, so that only the level rules speak. */
	function doorWith(tags: Record<string, string>) {
		return [
			node("n1"),
			node("n2"),
			node("n9", tags),
			way("w1", ["n1", "n9", "n2"], { indoor: "wall" }),
		];
	}

	it.each([
		[
			{ door: "hinged", level: "0;1" },
			{ door: "hinged", level: "0", repeat_on: "1" },
		],
		[
			{ entrance: "yes", level: "-1-1" },
			{ entrance: "yes", level: "-1", repeat_on: "0;1" },
		],
		[
			{ window: "yes", level: "0;2" },
			{ window: "yes", level: "0", repeat_on: "2" },
		],
		[
			{ emergency: "fire_extinguisher", level: "0;1", repeat_on: "3" },
			{ emergency: "fire_extinguisher", level: "0", repeat_on: "1;3" },
		],
		// SIT's vertical connections: an elevator's door is one node repeated.
		[
			{ door: "sliding", elevator: "yes", level: "0;1;2" },
			{ door: "sliding", elevator: "yes", level: "0", repeat_on: "1;2" },
		],
	])("moves all but the lowest of %j to repeat_on", (tags, expected) => {
		const entities = doorWith(tags);
		expect(issuesOf(entities, "n9")).toMatchObject([
			{ rule: "opening-on-several-levels" },
		]);
		expect(fixed(entities, "n9")).toEqual(expected);
	});

	it("leaves a range it can't list alone (0-0.5)", () => {
		expect(issuesOf(doorWith({ door: "yes", level: "0-0.5" }), "n9")).toEqual(
			[],
		);
	});

	it("accepts an opening on one level, repeated", () => {
		expect(
			issuesOf(doorWith({ door: "yes", level: "0", repeat_on: "1;2" }), "n9"),
		).toEqual([]);
	});
});

/**
 * A 22 m square building (n101–n104), a room in its middle (n201–n204, about 11 m wide) and the given
 * extra entities. Positions are [lon, lat] near 0, 0.
 */
function building(
	buildingTags: Record<string, string>,
	roomTags: Record<string, string> | null,
	...extra: Entity[]
): Entity[] {
	const square = (first: number, from: number, to: number) => [
		node(`n${first}`, {}, [from, from]),
		node(`n${first + 1}`, {}, [to, from]),
		node(`n${first + 2}`, {}, [to, to]),
		node(`n${first + 3}`, {}, [from, to]),
	];
	return [
		...square(101, 0, 0.0002),
		way("w1", ["n101", "n102", "n103", "n104", "n101"], buildingTags),
		...(roomTags
			? [
					...square(201, 0.00005, 0.00015),
					way("w2", ["n201", "n202", "n203", "n204", "n201"], roomTags),
				]
			: []),
		...extra,
	];
}

function rulesOf(entities: Entity[], id: EntityId) {
	return issuesOf(entities, id).map((i) => i.rule);
}

describe("validate: missing level", () => {
	it("flags an indoor feature without a level, fixed with the level shown", () => {
		const entities = roomWith({ indoor: "room", name: "Office" });
		const [issue, ...rest] = issuesOf(entities, "w1");
		expect(rest).toEqual([]);
		expect(issue).toMatchObject({ rule: "missing-level", fix: undefined });
		const fix = issue?.levelFix?.(2);
		expect(fix?.label).toEqual(msg("fix_set_level", { level: "2" }));
		const graph = fix?.action(Graph.fromEntities(entities));
		expect(graph?.entity("w1")?.tags).toEqual({
			indoor: "room",
			name: "Office",
			level: "2",
		});
	});

	it("accepts a level from repeat_on, min_level or a parent multipolygon", () => {
		// The level is read from repeat_on; SIT only asks for repeat_on on points.
		expect(rulesOf(roomWith({ indoor: "room", repeat_on: "0" }), "w1")).toEqual(
			["repeat-on-way"],
		);
		expect(
			rulesOf(
				roomWith({ indoor: "room", min_level: "0", max_level: "1" }),
				"w1",
			),
		).toEqual([]);
	});

	it("flags a feature inside an indoor outline without a level", () => {
		const shop = node("n9", { shop: "books" }, [0.0001, 0.0001]);
		expect(
			rulesOf(
				building({ building: "yes" }, { indoor: "room", level: "0" }, shop),
				"n9",
			),
		).toEqual(["missing-level"]);
	});

	it("leaves features outside indoor outlines alone, also inside a building", () => {
		const shop = node("n9", { shop: "books" }, [0.00002, 0.00002]);
		expect(
			rulesOf(
				building({ building: "yes" }, { indoor: "room", level: "0" }, shop),
				"n9",
			),
		).toEqual([]);
	});

	it("leaves a vertex to the levels of its ways", () => {
		expect(
			rulesOf(
				building(
					{ building: "yes" },
					{ indoor: "room", level: "0" },
					node("n201", { door: "hinged" }, [0.00005, 0.00005]),
				),
				"n201",
			),
		).toEqual([]);
	});
});

describe("validate: doors and entrances", () => {
	it("flags a door on a wall drawn as an area", () => {
		const entities = [
			node("n1", {}, [0, 0]),
			node("n2", {}, [0.00001, 0]),
			node("n3", {}, [0.00001, 0.00001]),
			node("n9", { door: "hinged", level: "0" }, [0, 0.00001]),
			way("w1", ["n1", "n2", "n3", "n9", "n1"], {
				indoor: "wall",
				area: "yes",
				level: "0",
			}),
		];
		const [issue] = issuesOf(entities, "n9");
		expect(issue).toMatchObject({ rule: "door-not-on-wall" });
		expect(issue?.message).toEqual(msg("issue_door_on_wall_area"));
	});

	it("accepts a door on a wall area that is also on a room's outline (the approved proposal)", () => {
		const entities = [
			node("n1", {}, [0, 0]),
			node("n2", {}, [0.00001, 0]),
			node("n3", {}, [0.00001, 0.00001]),
			node("n4", {}, [-0.00001, 0.00001]),
			node("n9", { door: "hinged", level: "0" }, [0, 0.00001]),
			way("w1", ["n1", "n2", "n3", "n9", "n1"], {
				indoor: "wall",
				area: "yes",
				level: "0",
			}),
			way("w2", ["n1", "n9", "n4", "n1"], { indoor: "room", level: "0" }),
		];
		expect(rulesOf(entities, "n9")).toEqual([]);
	});

	it("takes a closed indoor=wall without area=yes for a wall line, doors and all", () => {
		const entities = [
			node("n1", {}, [0, 0]),
			node("n2", {}, [0.00001, 0]),
			node("n3", {}, [0.00001, 0.00001]),
			node("n9", { door: "hinged", level: "0" }, [0, 0.00001]),
			way("w1", ["n1", "n2", "n3", "n9", "n1"], {
				indoor: "wall",
				level: "0",
			}),
		];
		expect(rulesOf(entities, "n9")).toEqual([]);
	});

	it("flags a door on the outer wall without entrance=*, fixed with entrance=yes", () => {
		const entities = building(
			{ building: "yes" },
			null,
			node("n9", { door: "hinged", level: "0" }, [0.0001, 0]),
		);
		entities.push(
			way("w3", ["n101", "n9", "n102"], { indoor: "wall", level: "0" }),
		);
		expect(rulesOf(entities, "n9")).toEqual(["outer-door-no-entrance"]);
		expect(fixed(entities, "n9")).toEqual({
			door: "hinged",
			level: "0",
			entrance: "yes",
		});
	});

	it("accepts the door once it has entrance=*", () => {
		const entities = building(
			{ building: "yes" },
			null,
			node("n9", { door: "hinged", entrance: "main", level: "0" }, [0.0001, 0]),
			way("w3", ["n101", "n9", "n102"], { indoor: "wall", level: "0" }),
		);
		expect(rulesOf(entities, "n9")).toEqual([]);
	});

	it("flags a door on the outline of a level of its own level only", () => {
		const door = (level: string) =>
			building(
				{ indoor: "level", level: "1" },
				null,
				node("n9", { door: "hinged", level }, [0.0001, 0]),
				way("w3", ["n101", "n9", "n102"], { indoor: "wall", level }),
			);
		expect(rulesOf(door("1"), "n9")).toEqual(["outer-door-no-entrance"]);
		expect(rulesOf(door("0"), "n9")).toEqual([]);
	});

	it("leaves doors inside the building alone", () => {
		const entities = building(
			{ building: "yes" },
			{ indoor: "room", level: "0" },
			node("n9", { door: "hinged" }, [0.0001, 0.00005]),
		);
		entities.push(
			way("w3", ["n201", "n9", "n202"], { indoor: "wall", level: "0" }),
		);
		expect(rulesOf(entities, "n9")).toEqual([]);
	});

	it("flags entrance=yes inside the building, fixed to an indoor door", () => {
		const entities = building(
			{ building: "yes" },
			{ indoor: "room", level: "0" },
			node("n9", { entrance: "yes", level: "0" }, [0.0001, 0.00005]),
		);
		entities.push(
			way("w3", ["n201", "n9", "n202"], { indoor: "wall", level: "0" }),
		);
		const [issue, ...rest] = issuesOf(entities, "n9");
		expect(rest).toEqual([]);
		expect(issue).toMatchObject({ rule: "entrance-inside" });
		expect(issue?.fix?.label).toEqual(
			msg("fix_entrance_to_door", { door: "yes" }),
		);
		expect(fixed(entities, "n9")).toEqual({
			indoor: "door",
			door: "yes",
			level: "0",
		});
	});

	it("flags any entrance=* inside the building, not only entrance=yes", () => {
		const entities = building(
			{ building: "yes" },
			{ indoor: "room", level: "0" },
			node(
				"n9",
				{ entrance: "main", door: "hinged", level: "0" },
				[0.0001, 0.00005],
			),
		);
		entities.push(
			way("w3", ["n201", "n9", "n202"], { indoor: "wall", level: "0" }),
		);
		expect(rulesOf(entities, "n9")).toEqual(["entrance-inside"]);
	});

	it("accepts an entrance on the outline of its own level (a skybridge's)", () => {
		const entities = building(
			{ building: "yes" },
			{ indoor: "level", level: "1" },
			node(
				"n9",
				{ entrance: "yes", door: "yes", level: "1" },
				[0.0001, 0.00005],
			),
		);
		entities.push(
			way("w3", ["n201", "n9", "n202"], { indoor: "wall", level: "1" }),
		);
		expect(rulesOf(entities, "n9")).toEqual([]);
		const other = entities.map((e) =>
			e.id === "n9" ? { ...e, tags: { ...e.tags, level: "0" } } : e,
		);
		expect(rulesOf(other, "n9")).toContain("entrance-inside");
	});

	it("accepts an entrance on a courtyard's ring, the tags on the outer way", () => {
		const entities = building(
			{ building: "yes" },
			{},
			node("n9", { entrance: "yes" }, [0.0001, 0.00005]),
			relation("r1", [
				{ ref: "w1", role: "outer" },
				{ ref: "w2", role: "inner" },
			]),
		);
		const w2 = entities.find((e) => e.id === "w2");
		if (w2?.type !== "way") throw new Error("No w2");
		const onRing = {
			...w2,
			nodes: ["n201", "n9", "n202", "n203", "n204", "n201"],
		} as typeof w2;
		entities[entities.indexOf(w2)] = onRing;
		expect(rulesOf(entities, "n9")).toEqual([]);
		// The same node on a plain indoor wall is inside.
		entities[entities.indexOf(onRing)] = {
			...onRing,
			tags: { indoor: "wall" },
		};
		entities.pop();
		expect(rulesOf(entities, "n9")).toContain("entrance-inside");
	});

	it("accepts entrance=yes on the outline, or within 0.5 m of it", () => {
		const at = (lat: number) =>
			building(
				{ building: "yes" },
				null,
				node("n9", { entrance: "yes" }, [0.0001, lat]),
			);
		expect(rulesOf(at(0), "n9")).toEqual([]);
		// 0.000003° of latitude is 0.33 m.
		expect(rulesOf(at(0.000003), "n9")).toEqual([]);
	});
});

describe("validate: one-based level numbers", () => {
	it("hints at numbering from 1 without changing anything", () => {
		const entities = building(
			{ building: "yes", "building:levels": "2" },
			{ indoor: "room", level: "1;2" },
		);
		const [issue, ...rest] = issuesOf(entities, "w1");
		expect(rest).toEqual([]);
		expect(issue).toMatchObject({ rule: "one-based-levels" });
		expect(issue?.message).toEqual(msg("issue_one_based_levels", { count: 2 }));
		expect(issue?.fix).toBeUndefined();
	});

	it.each([
		["a level 0", "0;1;2"],
		["nothing above building:levels", "1"],
	])("says nothing with %s", (_, level) => {
		const entities = building(
			{ building: "yes", "building:levels": "2" },
			{ indoor: "room", level },
		);
		expect(rulesOf(entities, "w1")).toEqual([]);
	});
});

describe("validate: non-existent levels", () => {
	const skips13 = { building: "yes", non_existent_levels: "4;13" };

	it("flags a room on a level its building skips, without a fix", () => {
		const [issue, ...rest] = issuesOf(
			building(skips13, { indoor: "room", level: "13" }),
			"w2",
		);
		expect(rest).toEqual([]);
		expect(issue).toMatchObject({ rule: "non-existent-level" });
		expect(issue?.message).toEqual(
			msg("issue_non_existent_level", { level: "13" }),
		);
		expect(issue?.fix).toBeUndefined();
	});

	it("flags a point inside the building, naming every skipped level", () => {
		const entities = building(
			skips13,
			null,
			node(
				"n9",
				{ amenity: "toilets", level: "4", repeat_on: "13" },
				[0.0001, 0.0001],
			),
		);
		expect(issuesOf(entities, "n9")[0]?.message).toEqual(
			msg("issue_non_existent_level", { level: "4;13" }),
		);
	});

	it.each([
		["an elevator through the skipped level", "12-14"],
		["another level", "12"],
	])("says nothing about %s", (_, level) => {
		const tags = { indoor: "room", highway: "elevator", level };
		expect(rulesOf(building(skips13, tags), "w2")).toEqual([]);
	});

	it("says nothing outside the building", () => {
		const entities = building(
			skips13,
			null,
			node("n9", { amenity: "toilets", level: "13" }, [0.001, 0.001]),
		);
		expect(rulesOf(entities, "n9")).not.toContain("non-existent-level");
	});
});

describe("validate: a room on several levels", () => {
	const rules = (tags: Record<string, string>) =>
		issuesOf(roomWith(tags), "w1").map((i) => i.rule);

	it("suggests one room per level, sharing the nodes", () => {
		const entities = roomWith({ indoor: "room", level: "0-2" });
		const graph = Graph.fromEntities(entities);
		const issue = validate(graph, ["w1"], RULES).find(
			(i) => i.rule === "room-on-several-levels",
		);
		expect(issue?.message).toEqual(
			msg("issue_room_on_several_levels", { indoor: "room", level: "0-2" }),
		);
		expect(issue?.fix?.label).toEqual(msg("fix_room_per_level", { count: 3 }));
		const after = issue?.fix?.action(graph);
		expect(after?.entity("w1")?.tags.level).toBe("0");
		expect(after?.changes().created.map((w) => w.tags.level)).toEqual([
			"1",
			"2",
		]);
	});

	it("leaves alone one level, stairs, elevators, atriums and repeat_on", () => {
		expect(rules({ indoor: "room", level: "1" })).not.toContain(
			"room-on-several-levels",
		);
		const kept: Record<string, string>[] = [
			{ indoor: "room", level: "0;1", stairs: "yes" },
			{ indoor: "room", level: "0;1", room: "elevator" },
			{ indoor: "area", level: "0;1", room: "atrium" },
			{ indoor: "room", level: "0", repeat_on: "1" },
			{ indoor: "room", level: "0-0.5" },
			{ indoor: "level", level: "0;1" },
		];
		for (const tags of kept) {
			expect(rules(tags)).not.toContain("room-on-several-levels");
		}
	});
});

describe("missing-tags: a point or way with nothing but its level", () => {
	const line = (tags: Record<string, string>) => [
		node("n1", {}, [0, 0]),
		node("n2", {}, [0.0001, 0]),
		way("w1", ["n1", "n2"], tags),
	];
	const rules = (entities: Entity[], id: EntityId) =>
		issuesOf(entities, id).map((i) => i.rule);

	it("flags a line with only a level, with a fix that deletes it", () => {
		const entities = line({ level: "0" });
		expect(rules(entities, "w1")).toContain("missing-tags");
		const graph = Graph.fromEntities(entities);
		const issue = validate(graph, ["w1"], RULES).find(
			(i) => i.rule === "missing-tags",
		);
		const after = issue?.fix?.action(graph);
		expect(after?.entity("w1")).toBeUndefined();
		expect(after?.entity("n1")).toBeUndefined();
	});

	it("flags a point with only a level", () => {
		expect(rules([node("n1", { level: "0" })], "n1")).toContain("missing-tags");
	});

	it("leaves tagged features, untagged vertices and untagged member ways alone", () => {
		expect(rules(line({ level: "0", indoor: "wall" }), "w1")).not.toContain(
			"missing-tags",
		);
		expect(rules(line({ level: "0" }), "n1")).not.toContain("missing-tags");
		const member = [
			...line({}),
			relation("r1", [{ ref: "w1", role: "outer" }], {
				type: "multipolygon",
				indoor: "room",
			}),
		];
		expect(rules(member, "w1")).not.toContain("missing-tags");
	});
});
