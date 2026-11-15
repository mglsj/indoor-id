import { describe, expect, it } from "vitest";
import { toolsFor } from "./scope-tools.ts";

describe("toolsFor (B.3)", () => {
	it("offers iD's tools on the map: point, line, area, outside operations, plain snaps", () => {
		const map = toolsFor("map");
		expect([...map.draw]).toEqual(["point", "line", "area"]);
		for (const id of [
			"delete",
			"square",
			"copy",
			"paste",
			"move",
			"rotate",
		] as const)
			expect(map.operation(id)).toBe(true);
		for (const id of [
			"merge",
			"repeat",
			"side",
			"offset",
			"square-frame",
		] as const)
			expect(map.operation(id)).toBe(false);
		expect(map.snap("points")).toBe(true);
		expect(map.snap("angles")).toBe(true);
		for (const option of [
			"grid",
			"planVertices",
			"extensions",
			"parallels",
			"tracking",
			"intersections",
		] as const)
			expect(map.snap(option)).toBe(false);
		expect(map).toMatchObject({
			grid: false,
			frame: false,
			guides: false,
			typed: false,
			floorPlans: false,
			levels: false,
		});
	});

	it("offers everything inside a building", () => {
		const building = toolsFor("building");
		expect([...building.draw]).toEqual([
			"point",
			"line",
			"area",
			"rectangle",
			"split",
			"measure",
		]);
		expect(building.operation("merge")).toBe(true);
		expect(building.snap("grid")).toBe(true);
		expect(building).toMatchObject({
			grid: true,
			frame: true,
			guides: true,
			typed: true,
			floorPlans: true,
			levels: true,
		});
	});
});
