import { describe, expect, it } from "vitest";
import { msg } from "#lib/i18n/messages.ts";
import type { Entity, EntityId } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { LOCAL_UPGRADES, type UpgradeRule, upgradeTags } from "./upgrades.ts";
import { validate } from "./validate.ts";

/** A few rules in the format of iD's deprecated.json. */
const SCHEMA: UpgradeRule[] = [
	{ old: { diaper: "yes" }, replace: { changing_table: "yes" } },
	{ old: { "building:height": "*" }, replace: { height: "$1" } },
	{ old: { "fixme:type": "*" } },
];
const RULES = [...SCHEMA, ...LOCAL_UPGRADES];

/** A room way around four untagged nodes, with the given tags. */
function roomWith(tags: Record<string, string>): Entity[] {
	return [
		node("n1"),
		node("n2"),
		node("n3"),
		way("w1", ["n1", "n2", "n3", "n1"], tags),
	];
}

function issuesOf(entities: Entity[], id: EntityId) {
	return validate(Graph.fromEntities(entities), [id], RULES);
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
		[
			{ indoor: "room", room: "stairs" },
			{ indoor: "room", stairs: "yes" },
		],
		[
			{ indoor: "room", room: "elevator" },
			{ indoor: "room", elevator: "yes" },
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
			{ indoor: "room", elevator: "yes" },
		],
		[
			{
				buildingpart: "verticalpassage",
				"buildingpart:verticalpassage": "stairway",
			},
			{ indoor: "room", stairs: "yes" },
		],
		[
			{ indoor: "room", amenity: "toilets", diaper: "yes" },
			{ indoor: "room", amenity: "toilets", changing_table: "yes" },
		],
	])("upgrades %j to %j", (tags, expected) => {
		const entities = roomWith(tags);
		expect(issuesOf(entities, "w1")).toMatchObject([
			{ rule: "outdated-tags", entityId: "w1" },
		]);
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

	it("accepts repeat_on for features repeated on several levels", () => {
		expect(
			issuesOf(
				roomWith({
					indoor: "room",
					amenity: "toilets",
					level: "0",
					repeat_on: "1;2",
				}),
				"w1",
			),
		).toEqual([]);
	});
});

describe("validate: issue ids", () => {
	it("gives each issue its own id, also for two unreadable level keys", () => {
		const issues = issuesOf(
			roomWith({ indoor: "room", level: "G", repeat_on: "G" }),
			"w1",
		);
		const ids = issues.map((i) => i.id);
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
		node("n9", { door: "yes" }),
	]);
	expect(validate(graph, ["n9"], RULES).map((i) => i.entityId)).toEqual(["n9"]);
	expect(validate(graph, ["w404"], RULES)).toEqual([]);
});
