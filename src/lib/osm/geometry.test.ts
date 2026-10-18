import { describe, expect, it } from "vitest";
import { node, way } from "./fixtures.ts";
import {
	distanceToLine,
	distanceToSegment,
	EARTH_RADIUS,
	extentOf,
	extentsIntersect,
	fromMercator,
	isClosed,
	isClosedRing,
	midpoint,
	pointInPolygon,
	pointInRing,
	toMercator,
	wayLocs,
} from "./geometry.ts";
import { Graph } from "./graph.ts";

describe("closed ways", () => {
	it("a way is closed when it ends where it starts", () => {
		expect(isClosed(way("w1", ["n1", "n2", "n1"]))).toBe(true);
		expect(isClosed(way("w1", ["n1", "n2", "n3"]))).toBe(false);
		expect(isClosed(way("w1", ["n1"]))).toBe(false);
	});

	it("a ring needs three corners: four nodes, the first repeated", () => {
		expect(isClosedRing(way("w1", ["n1", "n2", "n3", "n1"]))).toBe(true);
		expect(isClosedRing(way("w1", ["n1", "n2", "n1"]))).toBe(false);
		expect(isClosedRing(way("w1", ["n1", "n2", "n3", "n4"]))).toBe(false);
	});
});

describe("Graph.childNodes and wayLocs", () => {
	const graph = Graph.fromEntities([
		node("n1", {}, [0, 0]),
		node("n2", {}, [1, 0]),
		way("w1", ["n1", "n2", "n3", "n1"]),
	]);

	it("gives a way's nodes in order, skipping those not downloaded", () => {
		const w1 = graph.entity("w1");
		if (w1?.type !== "way") throw new Error("no way");
		expect(graph.childNodes(w1).map((n) => n.id)).toEqual(["n1", "n2", "n1"]);
		expect(wayLocs(graph, w1)).toEqual([
			[0, 0],
			[1, 0],
			[0, 0],
		]);
	});
});

describe("point in polygon", () => {
	const square = [
		[0, 0],
		[4, 0],
		[4, 4],
		[0, 4],
		[0, 0],
	];
	const hole = [
		[1, 1],
		[3, 1],
		[3, 3],
		[1, 3],
		[1, 1],
	];

	it("tells inside from outside a ring, closed or not", () => {
		expect(pointInRing([2, 2], square)).toBe(true);
		expect(pointInRing([5, 2], square)).toBe(false);
		expect(pointInRing([2, 2], square.slice(0, 4))).toBe(true);
	});

	it("leaves out a polygon's holes", () => {
		expect(pointInPolygon([0.5, 0.5], [square, hole])).toBe(true);
		expect(pointInPolygon([2, 2], [square, hole])).toBe(false);
		expect(pointInPolygon([2, 2], [])).toBe(false);
	});
});

describe("extents", () => {
	it("bounds points, or none", () => {
		expect(
			extentOf([
				[1, 5],
				[-2, 3],
				[4, -1],
			]),
		).toEqual({ west: -2, south: -1, east: 4, north: 5 });
		expect(extentOf([])).toBeNull();
	});

	it("intersect when they overlap or touch", () => {
		const a = { west: 0, south: 0, east: 2, north: 2 };
		expect(extentsIntersect(a, { west: 2, south: 2, east: 3, north: 3 })).toBe(
			true,
		);
		expect(
			extentsIntersect(a, { west: 2.1, south: 0, east: 3, north: 1 }),
		).toBe(false);
	});
});

describe("Web Mercator", () => {
	it("projects to metres on the sphere of radius 6378137 (EPSG:3857)", () => {
		expect(EARTH_RADIUS).toBe(6378137);
		const [x, y] = toMercator([180, 0]);
		expect(x).toBeCloseTo(20037508.34, 2);
		expect(y).toBeCloseTo(0, 6);
		// tan(45° + 30°) = 2 + √3.
		expect(toMercator([0, 60])[1]).toBeCloseTo(
			6378137 * Math.log(2 + Math.sqrt(3)),
			6,
		);
	});

	it("comes back to where it started", () => {
		const [lon, lat] = fromMercator(toMercator([-1.69, 48.13]));
		expect(lon).toBeCloseTo(-1.69, 10);
		expect(lat).toBeCloseTo(48.13, 10);
	});
});

describe("midpoint", () => {
	it("is halfway as drawn on the map, in Web Mercator", () => {
		expect(midpoint([0, 0], [2, 0])).toEqual([1, 0]);
		// Halfway between 60° and 70° north on a Mercator map is about 65.47°, not 65°.
		const [lon, lat] = midpoint([10, 60], [10, 70]);
		expect(lon).toBeCloseTo(10, 10);
		expect(lat).toBeCloseTo(65.47, 2);
	});
});

describe("distances in metres", () => {
	// One thousandth of a degree of latitude: 6371008.8 m × π / 180 / 1000 ≈ 111.195 m.
	const MILLIDEGREE = 111.195;

	it("to a segment: to its nearest end, or across it", () => {
		const a = [0, 0] as const;
		const b = [0, 0.002] as const;
		expect(distanceToSegment([0, 0.003], a, b)).toBeCloseTo(MILLIDEGREE, 2);
		expect(distanceToSegment([0, -0.001], a, b)).toBeCloseTo(MILLIDEGREE, 2);
		// At the equator, a thousandth of a degree east is as long.
		expect(distanceToSegment([0.001, 0.001], a, b)).toBeCloseTo(MILLIDEGREE, 2);
		expect(distanceToSegment([0, 0.001], a, a)).toBeCloseTo(MILLIDEGREE, 2);
	});

	it("to a line, through its nearest segment, or to a single point", () => {
		const line = [
			[0, 0],
			[0, 0.002],
			[0.002, 0.002],
		] as const;
		expect(distanceToLine([0.001, 0.003], line)).toBeCloseTo(MILLIDEGREE, 2);
		expect(distanceToLine([0, 0.001], [[0, 0]])).toBeCloseTo(MILLIDEGREE, 2);
	});
});
