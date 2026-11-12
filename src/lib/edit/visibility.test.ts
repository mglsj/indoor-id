import { describe, expect, it } from "vitest";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { tooLargeToEdit, visibleShare } from "./visibility.ts";

const view = { west: 0, south: 0, east: 10, north: 10 };

describe("visibleShare", () => {
	it("is the share of the extent's area inside the view", () => {
		expect(visibleShare({ west: 2, south: 2, east: 4, north: 4 }, view)).toBe(
			1,
		);
		expect(visibleShare({ west: 5, south: 0, east: 15, north: 10 }, view)).toBe(
			0.5,
		);
		expect(visibleShare({ west: 5, south: 5, east: 15, north: 15 }, view)).toBe(
			0.25,
		);
		expect(
			visibleShare({ west: 20, south: 20, east: 30, north: 30 }, view),
		).toBe(0);
	});

	it("counts a straight line or a point by where it lies", () => {
		expect(visibleShare({ west: 5, south: 3, east: 15, north: 3 }, view)).toBe(
			0.5,
		);
		expect(visibleShare({ west: 3, south: 3, east: 3, north: 3 }, view)).toBe(
			1,
		);
		expect(visibleShare({ west: 3, south: 30, east: 3, north: 30 }, view)).toBe(
			0,
		);
	});
});

describe("tooLargeToEdit", () => {
	const graph = Graph.fromEntities([
		node("n1", {}, [0, 0]),
		node("n2", {}, [10, 0]),
		node("n3", {}, [10, 10]),
		node("n4", {}, [20, 0]),
		way("w1", ["n1", "n2", "n3", "n1"]),
		way("w2", ["n2", "n4"]),
	]);

	it("refuses features less than 80% in view, together", () => {
		expect(tooLargeToEdit(graph, ["w1"], view)).toBe(false);
		expect(
			tooLargeToEdit(graph, ["w1"], {
				west: 0,
				south: 0,
				east: 8.5,
				north: 10,
			}),
		).toBe(false);
		expect(
			tooLargeToEdit(graph, ["w1"], { west: 0, south: 0, east: 7, north: 10 }),
		).toBe(true);
		expect(tooLargeToEdit(graph, ["w1", "w2"], view)).toBe(true);
	});

	it("allows anything when the view isn't known", () => {
		expect(tooLargeToEdit(graph, ["w1", "w2"], undefined)).toBe(false);
	});
});
