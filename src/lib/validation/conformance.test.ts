import { describe, expect, it } from "vitest";
import { msg } from "#lib/i18n/messages.ts";
import type { Entity, EntityId } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { LOCAL_UPGRADES } from "./upgrades.ts";
import { type IssueRule, validate } from "./validate.ts";

/** W2's rules; the others are tested in validate.test.ts and spatial.test.ts. */
const W2: readonly IssueRule[] = [
	"escalator-levels",
	"flight-incline",
	"escalator-shape",
	"escalator-end",
	"flight-over-levels",
	"room-amenity",
	"sliver",
	"small-level-outline",
	"platform-no-level",
	"duplicate-node",
];

function issuesOf(entities: Entity[], id: EntityId) {
	return validate(Graph.fromEntities(entities), [id], LOCAL_UPGRADES).filter(
		(i) => W2.includes(i.rule),
	);
}

const rulesOf = (entities: Entity[], id: EntityId) =>
	issuesOf(entities, id).map((i) => i.rule);

/** A rectangle way `id` with nodes n{first}..n{first+3}, from (x0, y0) to (x1, y1) degrees. */
function rect(
	id: `w${number}`,
	first: number,
	[x0, y0]: [number, number],
	[x1, y1]: [number, number],
	tags: Record<string, string>,
): Entity[] {
	const [a, b, c, d] = [0, 1, 2, 3].map((i) => `n${first + i}` as const) as [
		`n${number}`,
		`n${number}`,
		`n${number}`,
		`n${number}`,
	];
	return [
		node(a, {}, [x0, y0]),
		node(b, {}, [x1, y0]),
		node(c, {}, [x1, y1]),
		node(d, {}, [x0, y1]),
		way(id, [a, b, c, d, a], tags),
	];
}

/** An escalator line from (0.00002, 0.00005) to (0.00008, 0.00005): about 6.7 m. */
function escalator(tags: Record<string, string>, ...extra: Entity[]): Entity[] {
	return [
		node("n1", {}, [0.00002, 0.00005]),
		node("n2", {}, [0.00008, 0.00005]),
		way("w1", ["n1", "n2"], {
			highway: "steps",
			conveying: "forward",
			...tags,
		}),
		...extra,
	];
}

describe("conformance: escalators and stairs", () => {
	it("accepts an escalator with both levels, an incline and two points", () => {
		expect(rulesOf(escalator({ level: "0;1", incline: "up" }), "w1")).toEqual(
			[],
		);
	});

	it("wants both end levels in level", () => {
		const [issue] = issuesOf(escalator({ level: "0", incline: "up" }), "w1");
		expect(issue?.rule).toBe("escalator-levels");
		expect(issue?.message).toEqual(msg("issue_escalator_levels"));
	});

	it("wants incline=up or down on escalators, and on stairs between levels", () => {
		expect(rulesOf(escalator({ level: "0;1" }), "w1")).toEqual([
			"flight-incline",
		]);
		expect(rulesOf(escalator({ level: "0;1", incline: "15%" }), "w1")).toEqual([
			"flight-incline",
		]);
		const stairs = (tags: Record<string, string>) => [
			node("n1", {}, [0, 0]),
			node("n2", {}, [0.00001, 0]),
			way("w1", ["n1", "n2"], { highway: "steps", ...tags }),
		];
		expect(rulesOf(stairs({ level: "0;1" }), "w1")).toEqual(["flight-incline"]);
		// A few steps on one level, or outdoor steps without a level: no incline needed.
		expect(rulesOf(stairs({ level: "0" }), "w1")).toEqual([]);
		expect(rulesOf(stairs({}), "w1")).toEqual([]);
	});

	it("wants an escalator drawn with two points", () => {
		const entities = escalator({ level: "0;1", incline: "up" });
		entities.push(node("n3", {}, [0.00009, 0.00005]));
		entities[2] = way("w1", ["n1", "n2", "n3"], {
			highway: "steps",
			conveying: "forward",
			level: "0;1",
			incline: "up",
		});
		expect(rulesOf(entities, "w1")).toEqual(["escalator-shape"]);
	});

	it("wants each end in a space of its own level, by the incline", () => {
		const halls = (low: string, high: string) => [
			// The bottom (west) end in a hall of `low`, the top (east) end in one of `high`.
			...rect("w11", 11, [0, 0], [0.00005, 0.0001], {
				indoor: "area",
				level: low,
			}),
			...rect("w12", 21, [0.00005, 0], [0.0001, 0.0001], {
				indoor: "area",
				level: high,
			}),
		];
		const up = { level: "0;1", incline: "up" };
		expect(rulesOf(escalator(up, ...halls("0", "1")), "w1")).toEqual([]);
		// Drawn from the top down, the same line says incline=down.
		expect(
			rulesOf(escalator({ ...up, incline: "down" }, ...halls("0", "1")), "w1"),
		).toEqual(["escalator-end", "escalator-end"]);
		const [issue] = issuesOf(escalator(up, ...halls("0", "0")), "w1");
		expect(issue?.rule).toBe("escalator-end");
		expect(issue?.message).toEqual(msg("issue_escalator_end", { level: "1" }));
	});

	it("says nothing about the ends where nothing is mapped yet", () => {
		expect(rulesOf(escalator({ level: "0;1", incline: "up" }), "w1")).toEqual(
			[],
		);
	});

	it("splits stairs drawn as an area over three levels into pairs", () => {
		const entities = rect("w1", 1, [0, 0], [0.00003, 0.00005], {
			highway: "steps",
			area: "yes",
			incline: "up",
			level: "0-2",
		});
		const graph = Graph.fromEntities(entities);
		const [issue, ...rest] = issuesOf(entities, "w1");
		expect(rest).toEqual([]);
		expect(issue?.rule).toBe("flight-over-levels");
		expect(issue?.message).toEqual(
			msg("issue_flight_over_levels", { level: "0-2" }),
		);
		expect(issue?.fix?.label).toEqual(msg("fix_flight_per_pair", { count: 2 }));
		const after = issue?.fix?.action(graph);
		expect(after?.entity("w1")?.tags.level).toBe("0;1");
		const [copy] = after?.changes().created ?? [];
		expect(copy?.tags.level).toBe("1;2");
		expect(copy).toMatchObject({ nodes: ["n1", "n2", "n3", "n4", "n1"] });
	});

	it("flags an escalator line over three levels without a fix", () => {
		const [issue] = issuesOf(
			escalator({ level: "0;1;2", incline: "up" }),
			"w1",
		);
		expect(issue?.rule).toBe("flight-over-levels");
		expect(issue?.fix).toBeUndefined();
	});

	it("leaves a stairwell spanning every floor alone", () => {
		const entities = rect("w1", 1, [0, 0], [0.00003, 0.00005], {
			indoor: "room",
			stairs: "yes",
			level: "0-5",
		});
		expect(rulesOf(entities, "w1")).toEqual([]);
	});
});

describe("conformance: rooms that want an amenity", () => {
	it.each([
		["reception", "reception_desk"],
		["dressing", "dressing_room"],
	])("adds amenity to room=%s", (room, amenity) => {
		const entities = rect("w1", 1, [0, 0], [0.00003, 0.00003], {
			indoor: "room",
			room,
			level: "0",
		});
		const graph = Graph.fromEntities(entities);
		const [issue] = issuesOf(entities, "w1");
		expect(issue?.message).toEqual(
			msg("issue_room_amenity", { room, amenity }),
		);
		expect(issue?.fix?.label).toEqual(msg("fix_add_amenity", { amenity }));
		expect(issue?.fix?.action(graph).entity("w1")?.tags).toEqual({
			indoor: "room",
			room,
			level: "0",
			amenity,
		});
	});

	it("leaves a room with an amenity, and room=technical, alone", () => {
		const cases: Record<string, string>[] = [
			{ room: "reception", amenity: "reception_desk" },
			{ room: "technical" },
			{ room: "service" },
		];
		for (const tags of cases) {
			const entities = rect("w1", 1, [0, 0], [0.00003, 0.00003], {
				indoor: "room",
				level: "0",
				...tags,
			});
			expect(rulesOf(entities, "w1")).toEqual([]);
		}
	});
});

describe("conformance: slivers", () => {
	const room = (
		width: number,
		length: number,
		tags: Record<string, string> = { indoor: "room" },
	) => rect("w1", 1, [0, 0], [length, width], { level: "0", ...tags });

	it("flags a ring with almost no width", () => {
		// 0.0001° ≈ 11 m long, 0.0000002° ≈ 2 cm wide.
		const [issue] = issuesOf(room(0.0000002, 0.0001), "w1");
		expect(issue?.rule).toBe("sliver");
		expect(issue?.message).toEqual(msg("issue_sliver"));
	});

	it("flags a ring whose corners are all on one spot", () => {
		expect(rulesOf(room(0, 0), "w1")).toEqual(["sliver"]);
	});

	it("leaves a small post alone: it is small, not narrow", () => {
		// About 6 × 6 cm, as way/605698045.
		expect(
			rulesOf(room(0.0000005, 0.0000005, { indoor: "column" }), "w1"),
		).toEqual([]);
	});

	it("leaves a long thin wall area alone", () => {
		// 50 m × 15 cm.
		expect(
			rulesOf(room(0.0000014, 0.00045, { indoor: "wall", area: "yes" }), "w1"),
		).toEqual([]);
	});
});

describe("conformance: level outlines smaller than their building", () => {
	const building = (tags: Record<string, string> = {}) =>
		rect("w1", 1, [0, 0], [0.0002, 0.0002], { building: "yes", ...tags });

	it("hints when a level outline covers much less than its building", () => {
		const entities = [
			...building(),
			...rect("w2", 11, [0, 0], [0.0001, 0.0001], {
				indoor: "level",
				level: "5",
			}),
		];
		const [issue] = issuesOf(entities, "w2");
		expect(issue?.rule).toBe("small-level-outline");
		expect(issue?.message).toEqual(
			msg("issue_small_level_outline", { percent: 25 }),
		);
		expect(issue?.fix).toBeUndefined();
	});

	it("accepts a level outline covering most of its building", () => {
		const entities = [
			...building(),
			...rect("w2", 11, [0.000005, 0.000005], [0.000195, 0.000185], {
				indoor: "level",
				level: "0",
			}),
		];
		expect(rulesOf(entities, "w2")).toEqual([]);
	});

	it("compares with the building parts that reach its level", () => {
		// A tower part over the west half reaches level 5; the east half has 2 levels.
		const entities = [
			...building(),
			...rect("w3", 21, [0, 0], [0.0001, 0.0002], {
				"building:part": "yes",
				"building:levels": "10",
			}),
			...rect("w4", 31, [0.0001, 0], [0.0002, 0.0002], {
				"building:part": "yes",
				"building:levels": "2",
			}),
			...rect("w2", 11, [0, 0], [0.0001, 0.0002], {
				indoor: "level",
				level: "5",
			}),
		];
		expect(rulesOf(entities, "w2")).toEqual([]);
	});
});

describe("conformance: platforms", () => {
	it("flags a platform inside a building without a level, fixed with level=0", () => {
		const entities = [
			...rect("w1", 1, [0, 0], [0.0002, 0.0002], { building: "train_station" }),
			...rect("w2", 11, [0.00005, 0.00005], [0.00015, 0.00007], {
				railway: "platform",
			}),
		];
		const graph = Graph.fromEntities(entities);
		const [issue] = issuesOf(entities, "w2");
		expect(issue?.rule).toBe("platform-no-level");
		expect(issue?.fix?.action(graph).entity("w2")?.tags).toEqual({
			railway: "platform",
			level: "0",
		});
	});

	it("leaves platforms outdoors, or with a level, alone", () => {
		const platform = rect("w2", 11, [0.00005, 0.00005], [0.00015, 0.00007], {
			railway: "platform",
		});
		expect(rulesOf(platform, "w2")).toEqual([]);
		const entities = [
			...rect("w1", 1, [0, 0], [0.0002, 0.0002], { building: "yes" }),
			...rect("w2", 11, [0.00005, 0.00005], [0.00015, 0.00007], {
				railway: "platform",
				level: "-1",
			}),
		];
		expect(rulesOf(entities, "w2")).toEqual([]);
	});
});

describe("conformance: duplicate nodes", () => {
	/** Two rooms side by side whose shared side is drawn twice (n2/n3 and n12/n11). */
	function rooms(left: string, right: string): Entity[] {
		return [
			...rect("w1", 1, [0, 0], [0.00003, 0.00003], {
				indoor: "room",
				level: left,
			}),
			...rect("w2", 11, [0.00003, 0], [0.00006, 0.00003], {
				indoor: "room",
				level: right,
			}),
		];
	}

	it("flags corners on the same spot on one level, once, with a merge", () => {
		const entities = rooms("0", "0");
		// n2 and n3 (w1) are the larger ids ("n2" > "n11"): w1 reports them, w2 doesn't.
		expect(rulesOf(entities, "w2")).toEqual([]);
		const issues = issuesOf(entities, "w1");
		expect(issues.map((i) => i.rule)).toEqual([
			"duplicate-node",
			"duplicate-node",
		]);
		expect(issues[0]?.message).toEqual(msg("issue_duplicate_node"));
		expect(issues.map((i) => i.at).sort()).toEqual(["n2", "n3"]);
		const graph = Graph.fromEntities(entities);
		const after = issues[0]?.fix?.action(graph);
		expect(after?.entity("n2")).toBeUndefined();
		expect(after?.entity("w1")).toMatchObject({
			nodes: ["n1", "n11", "n3", "n4", "n1"],
		});
	});

	it("leaves copies on other levels alone", () => {
		expect(rulesOf(rooms("0", "1"), "w2")).toEqual([]);
	});

	it("flags a ground floor room on the building's corners, as merges leave them", () => {
		const entities = [
			...rect("w1", 1, [0, 0], [0.0001, 0.0001], { building: "yes" }),
			...rect("w2", 11, [0, 0], [0.00005, 0.00005], {
				indoor: "room",
				level: "0",
			}),
		];
		expect(rulesOf(entities, "w2")).toEqual(["duplicate-node"]);
		const upstairs = entities.map((e) =>
			e.id === "w2" ? { ...e, tags: { indoor: "room", level: "1" } } : e,
		);
		expect(rulesOf(upstairs, "w2")).toEqual([]);
	});
});
