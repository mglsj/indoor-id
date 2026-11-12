import { describe, expect, it } from "vitest";
import type { Loc } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { fromLocal } from "#lib/osm/geometry.ts";
import { Graph } from "#lib/osm/graph.ts";
import { BuildingScope } from "./scope.svelte.ts";

const at = (east: number, north: number): Loc =>
	fromLocal([13.4, 52.5], [east, north]);

/** A 20 × 10 m building w1 with a room w2 inside; a shop n9 outside. */
function data(): Graph {
	return Graph.fromEntities([
		node("n1", {}, at(0, 0)),
		node("n2", {}, at(20, 0)),
		node("n3", {}, at(20, 10)),
		node("n4", {}, at(0, 10)),
		way("w1", ["n1", "n2", "n3", "n4", "n1"], { building: "yes" }),
		node("n5", {}, at(1, 1)),
		node("n6", {}, at(5, 1)),
		node("n7", {}, at(5, 5)),
		way("w2", ["n5", "n6", "n7", "n5"], { indoor: "room", level: "0" }),
		node("n9", { shop: "bakery" }, at(50, 50)),
	]);
}

describe("BuildingScope: the building entered", () => {
	it("starts in map mode, where nothing is in a scope", () => {
		const scope = new BuildingScope(() => data());
		expect(scope.id).toBeNull();
		expect(scope.current).toBeNull();
		expect(scope.contains("w2")).toBe(false);
	});

	it("enters a building and tells what belongs to it", () => {
		const scope = new BuildingScope(() => data());
		expect(scope.enter("w1")).toBe(true);
		expect(scope.current?.kind).toBe("building");
		expect(scope.contains("w2")).toBe(true);
		expect(scope.contains("n9")).toBe(false);
		expect(scope.members(["w1", "w2", "n9"])).toEqual(new Set(["w1", "w2"]));
		expect(scope.isOutline("w1")).toBe(true);
		expect(scope.isOutline("w2")).toBe(false);
		scope.leave();
		expect(scope.id).toBeNull();
		expect(scope.members(["w2"]).size).toBe(0);
		expect(scope.contains("w2")).toBe(false);
	});

	it("refuses a loaded feature that can't be entered", () => {
		const scope = new BuildingScope(() => data());
		expect(scope.enter("w2")).toBe(false);
		expect(scope.id).toBeNull();
	});

	it("keeps a building from a link until its data loads", () => {
		let graph = Graph.fromEntities([]);
		const scope = new BuildingScope(() => graph);
		expect(scope.enter("w1")).toBe(true);
		expect(scope.id).toBe("w1");
		expect(scope.current).toBeNull();
		graph = data();
		expect(scope.current?.id).toBe("w1");
		expect(scope.contains("w2")).toBe(true);
	});

	it("tells indoor data that no building holds, which map mode leaves unfaded", () => {
		const scope = new BuildingScope(() => data());
		const feature = (id: string, kind: string, loc: Loc) => ({
			type: "Feature" as const,
			properties: { "@id": id, "@lv": "*", "@kind": kind },
			geometry: { type: "Point" as const, coordinates: [...loc] },
		});
		expect(
			scope.unscoped([
				feature("n7", "poi", at(5, 5)),
				feature("n9", "poi", at(50, 50)),
				feature("w1", "building", at(10, 5)),
			]),
		).toEqual(new Set(["n9"]));
	});
});
