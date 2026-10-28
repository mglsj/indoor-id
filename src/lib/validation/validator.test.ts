import { describe, expect, it } from "vitest";
import { changeTags } from "#lib/actions/change-tags.ts";
import { deleteEntities } from "#lib/actions/delete.ts";
import { insertNodeInWay, moveNode } from "#lib/actions/geometry.ts";
import type { EntityId } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import type { UpgradeRule } from "./upgrades.ts";
import { validate } from "./validate.ts";
import { Validator } from "./validator.ts";

const UPGRADES: UpgradeRule[] = [
	{ old: { diaper: "yes" }, replace: { changing_table: "yes" } },
];

/** A wall n1–n2, a door n3 beside it (not on it), and a toilet n4 with an old tag. */
const start = () =>
	Graph.fromEntities([
		node("n1", {}, [0, 0]),
		node("n2", {}, [2, 0]),
		way("w1", ["n1", "n2"], { indoor: "wall", level: "0" }),
		node("n3", { door: "yes", level: "0" }, [1, 0]),
		node("n4", { amenity: "toilets", diaper: "yes" }, [5, 5]),
	]);

const ALL: EntityId[] = ["n1", "n2", "w1", "n3", "n4"];

/** Issue ids, sorted, as the validator gives them and as a full validation does. */
function check(validator: Validator, graph: Graph, upgrades = UPGRADES) {
	const ids = (issues: { id: string }[]) => issues.map((i) => i.id).sort();
	const cached = ids(validator.issues(graph, ALL, upgrades));
	expect(cached).toEqual(ids(validate(graph, ALL, upgrades)));
	return cached;
}

describe("Validator: issues cached per entity, checked again when an edit affects them", () => {
	it("gives what a full validation gives, after each kind of edit", () => {
		const validator = new Validator();
		let graph = start();
		expect(check(validator, graph)).toEqual([
			"door-not-on-wall:n3",
			"outdated-tags:n4",
		]);
		// A tag fixed.
		graph = changeTags("n4", { amenity: "toilets", changing_table: "yes" })(
			graph,
		);
		expect(check(validator, graph)).toEqual(["door-not-on-wall:n3"]);
		// The door put on the wall: only the wall changed, the door's issue goes.
		graph = insertNodeInWay("w1", "n3", 1)(graph);
		expect(check(validator, graph)).toEqual([]);
		// A node moved.
		graph = moveNode("n3", [1, 1])(graph);
		expect(check(validator, graph)).toEqual([]);
		// The wall deleted: the door it held is off a wall again.
		graph = deleteEntities(["w1"])(graph);
		expect(check(validator, graph)).toContain("door-not-on-wall:n3");
		// Undone: back to an earlier graph.
		check(validator, start());
	});

	it("checks again what a download brings, and everything when the upgrade rules change", () => {
		const validator = new Validator();
		const graph = start();
		check(validator, graph);
		const loaded = graph.withBaseEntities([
			node("n5", {}, [3, 0]),
			way("w2", ["n5", "n3"], { indoor: "wall" }),
		]);
		expect(check(validator, loaded)).toEqual(["outdated-tags:n4"]);
		expect(check(validator, loaded, [])).toEqual([]);
	});

	it("checks again what is around an outline that changed", () => {
		const validator = new Validator();
		const room = (graph: Graph) =>
			graph.update((g) =>
				[
					node("n6", {}, [4, 4]),
					node("n7", {}, [6, 4]),
					node("n8", {}, [6, 6]),
					node("n9", {}, [4, 6]),
					way("w3", ["n6", "n7", "n8", "n9", "n6"], {
						indoor: "room",
						level: "0",
					}),
				].reduce((next, entity) => next.replace(entity), g),
			);
		let graph = start();
		expect(check(validator, graph)).not.toContain("missing-level:n4");
		// A room drawn around the toilet: it needs a level now.
		graph = room(graph);
		expect(check(validator, graph)).toContain("missing-level:n4");
		// The room's corner moved, leaving the toilet outside.
		graph = moveNode("n8", [4.5, 4.5])(graph);
		expect(check(validator, graph)).not.toContain("missing-level:n4");
	});

	it("checks only the entities an edit affected", () => {
		const checked: EntityId[] = [];
		const validator = new Validator((graph, ids, upgrades) => {
			checked.push(...ids);
			return validate(graph, ids, upgrades);
		});
		const graph = start();
		validator.issues(graph, ALL, UPGRADES);
		expect(checked.sort()).toEqual([...ALL].sort());

		checked.length = 0;
		const retagged = changeTags("n4", { amenity: "toilets" })(graph);
		validator.issues(retagged, ALL, UPGRADES);
		expect(checked).toEqual(["n4"]);

		// A way changed: the way, and its nodes before and after.
		checked.length = 0;
		validator.issues(insertNodeInWay("w1", "n3", 1)(retagged), ALL, UPGRADES);
		expect(checked.sort()).toEqual(["n1", "n2", "n3", "w1"]);
	});
});
