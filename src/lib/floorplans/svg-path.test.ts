import { describe, expect, it } from "vitest";
import {
	applyTo,
	INITIAL_STYLE,
	parsePathData,
	parseTransform,
	resolveStyle,
	shapePath,
} from "./svg-path.ts";
import { VectorBuilder } from "./vector.ts";

const style = { color: [0, 0, 0, 255] as const, width: 0, layer: null };

/** The segments drawn by stroking path data, as [[x0, y0, x1, y1], …]. */
function stroked(d: string, matrix = parseTransform("")): number[][] {
	const builder = new VectorBuilder();
	applyTo(builder, parsePathData(d), matrix);
	builder.stroke(style);
	const { segments } = builder.build({ width: 100, height: 100 });
	return Array.from({ length: segments.length / 4 }, (_, i) =>
		[...segments.subarray(i * 4, i * 4 + 4)].map(
			(v) => Math.round(v * 1000) / 1000,
		),
	);
}

/** The points a stroked path goes through. */
function points(d: string): [number, number][] {
	return stroked(d).flatMap(([x0 = 0, y0 = 0, x1 = 0, y1 = 0], i) =>
		i === 0
			? [
					[x0, y0],
					[x1, y1],
				]
			: [[x1, y1]],
	) as [number, number][];
}

describe("parsePathData: SVG path data", () => {
	it("reads absolute and relative lines, horizontal and vertical ones, and closes", () => {
		expect(stroked("M10 10 L20 10 h10 v10 H10 V20 l0 -5 z")).toEqual([
			[10, 10, 20, 10],
			[20, 10, 30, 10],
			[30, 10, 30, 20],
			[30, 20, 10, 20],
			[10, 20, 10, 15],
			[10, 15, 10, 10],
		]);
	});

	it("reads numbers packed together and repeated commands as lines", () => {
		expect(stroked("m1,2 3-4.5.5e1 1")).toEqual([
			[1, 2, 4, -2.5],
			// .5e1 then 1: the relative pair (5, 1).
			[4, -2.5, 9, -1.5],
		]);
	});

	it("starts relative subpaths from the last closed one's start", () => {
		expect(stroked("M10 10 l10 0 z m5 5 l1 0")).toEqual([
			[10, 10, 20, 10],
			[20, 10, 10, 10],
			[15, 15, 16, 15],
		]);
	});

	it("draws curves, reflecting the control point of smooth ones", () => {
		// A smooth cubic after a symmetric one: an S-shape through (50, 0) and (100, 0).
		const s = points("M0 0 C0 -50 50 -50 50 0 S100 50 100 0");
		expect(s.at(-1)).toEqual([100, 0]);
		expect(s).toContainEqual([50, 0]);
		expect(Math.max(...s.map(([, y]) => y))).toBeGreaterThan(30);
		const t = points("M0 0 Q25 -50 50 0 T100 0");
		expect(t.at(-1)).toEqual([100, 0]);
		expect(Math.max(...t.map(([, y]) => y))).toBeGreaterThan(20);
	});

	it("draws arcs on their ellipse, the sweep flag choosing the side", () => {
		// From (0, 0) to (100, 0) on a circle of radius 50 around (50, 0).
		for (const [sweep, side] of [
			[1, -1],
			[0, 1],
		] as const) {
			const arc = points(`M0 0 A50 50 0 0 ${sweep} 100 0`);
			for (const [x, y] of arc) {
				expect(Math.abs(Math.hypot(x - 50, y) - 50)).toBeLessThan(0.11);
			}
			expect(arc.at(-1)).toEqual([100, 0]);
			const middle = arc.reduce((best, p) =>
				Math.abs(p[0] - 50) < Math.abs(best[0] - 50) ? p : best,
			);
			expect(Math.sign(middle[1])).toBe(side);
		}
		// Radii too small for the endpoints are scaled up to reach them.
		expect(points("M0 0 a1 1 0 0 1 100 0").at(-1)).toEqual([100, 0]);
	});
});

describe("parseTransform: SVG transform lists", () => {
	it("composes transforms left to right", () => {
		expect(
			stroked("M0 0 L10 0", parseTransform("translate(100 50) scale(2)")),
		).toEqual([[100, 50, 120, 50]]);
		expect(stroked("M0 0 L10 0", parseTransform("rotate(90)"))).toEqual([
			[0, 0, 0, 10],
		]);
		expect(stroked("M10 0 L20 0", parseTransform("rotate(90, 10, 0)"))).toEqual(
			[[10, 0, 10, 10]],
		);
		expect(
			stroked("M0 0 L10 0", parseTransform("matrix(1 0 0 1 5 6)")),
		).toEqual([[5, 6, 15, 6]]);
		expect(stroked("M0 10 L0 20", parseTransform("skewX(45)"))).toEqual([
			[10, 10, 20, 20],
		]);
	});
});

describe("shapePath: basic shapes as path data", () => {
	it("draws rectangles, lines, polylines and polygons", () => {
		expect(
			stroked(shapePath("rect", { x: "1", y: "2", width: "10", height: "5" })),
		).toEqual([
			[1, 2, 11, 2],
			[11, 2, 11, 7],
			[11, 7, 1, 7],
			[1, 7, 1, 2],
		]);
		expect(
			stroked(shapePath("line", { x1: "0", y1: "0", x2: "3", y2: "4" })),
		).toEqual([[0, 0, 3, 4]]);
		expect(
			stroked(shapePath("polyline", { points: "0,0 1,0 1,1" })),
		).toHaveLength(2);
		expect(
			stroked(shapePath("polygon", { points: "0,0 1,0 1,1" })),
		).toHaveLength(3);
	});

	it("draws circles and ellipses through their extreme points", () => {
		const circle = points(shapePath("circle", { cx: "50", cy: "50", r: "10" }));
		for (const [x, y] of circle) {
			expect(Math.abs(Math.hypot(x - 50, y - 50) - 10)).toBeLessThan(0.11);
		}
		const ellipse = points(
			shapePath("ellipse", { cx: "0", cy: "0", rx: "20", ry: "10" }),
		);
		expect(Math.max(...ellipse.map(([x]) => x))).toBeCloseTo(20, 1);
		expect(Math.max(...ellipse.map(([, y]) => y))).toBeCloseTo(10, 1);
	});

	it("draws nothing for a shape without size", () => {
		expect(shapePath("rect", { width: "0", height: "5" })).toBe("");
		expect(shapePath("circle", { r: "0" })).toBe("");
	});
});

describe("resolveStyle: presentation attributes and style, inherited", () => {
	it("starts black filled, unstroked, 1 unit wide", () => {
		expect(INITIAL_STYLE).toMatchObject({
			fill: "black",
			stroke: "none",
			strokeWidth: 1,
		});
	});

	it("takes attributes, then the style attribute over them, then passes them down", () => {
		const group = resolveStyle(INITIAL_STYLE, {
			stroke: "red",
			"stroke-width": "2",
			style: "stroke: blue; fill:none",
		});
		expect(group).toMatchObject({
			stroke: "blue",
			fill: "none",
			strokeWidth: 2,
		});
		const child = resolveStyle(group, { "stroke-opacity": "0.5" });
		expect(child).toMatchObject({
			stroke: "blue",
			fill: "none",
			strokeWidth: 2,
			strokeOpacity: 0.5,
		});
	});

	it("multiplies group opacity down, and resolves currentColor", () => {
		const group = resolveStyle(INITIAL_STYLE, {
			opacity: "0.5",
			color: "green",
		});
		const child = resolveStyle(group, { opacity: "0.5", fill: "currentColor" });
		expect(child.opacity).toBeCloseTo(0.25, 9);
		expect(child.fill).toBe("green");
	});

	it("sizes text in user units, em and % of the parent's size, 16 at first", () => {
		expect(INITIAL_STYLE).toMatchObject({ fontSize: 16, textAnchor: "start" });
		const group = resolveStyle(INITIAL_STYLE, {
			"font-size": "10",
			"text-anchor": "middle",
		});
		expect(group).toMatchObject({ fontSize: 10, textAnchor: "middle" });
		expect(resolveStyle(group, { style: "font-size: 2em" }).fontSize).toBe(20);
		expect(resolveStyle(group, { "font-size": "150%" }).fontSize).toBe(15);
		expect(resolveStyle(group, { "font-size": "12pt" }).fontSize).toBe(16);
		expect(resolveStyle(group, { "text-anchor": "end" }).textAnchor).toBe(
			"end",
		);
		expect(resolveStyle(group, { "text-anchor": "sideways" }).textAnchor).toBe(
			"middle",
		);
	});

	it("hides what display or visibility hide", () => {
		expect(resolveStyle(INITIAL_STYLE, { display: "none" }).hidden).toBe(true);
		expect(
			resolveStyle(INITIAL_STYLE, { style: "visibility:hidden" }).hidden,
		).toBe(true);
	});
});
