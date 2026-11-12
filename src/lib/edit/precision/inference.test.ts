import { beforeEach, describe, expect, test } from "vitest";
import type { Loc } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { fromLocal } from "#lib/osm/geometry.ts";
import { Graph } from "#lib/osm/graph.ts";
import type { Frame } from "./frame.ts";
import {
	EXTENSION_METRES,
	type Hovered,
	hoveredOf,
	Inferences,
	sideDirections,
} from "./inference.ts";

const O: Loc = [11.575, 48.137];
const at = (east: number, north: number) => fromLocal(O, [east, north]);
const frame: Frame = { origin: O, angle: 0 };

/** A side from (0, 0) to (4, 0) and a corner at (10, 10) whose sides go east and north-east. */
const side: Hovered = { kind: "side", key: "n1 n2", a: at(0, 0), b: at(4, 0) };
const corner: Hovered = {
	kind: "corner",
	key: "n9",
	loc: at(10, 10),
	directions: [0, 45],
};

let now = 0;
let inferences: Inferences;
beforeEach(() => {
	now = 0;
	inferences = new Inferences(() => now);
});

/** Hovers `item` from now for `ms`. */
function hoverFor(item: Hovered, ms: number) {
	inferences.hover(item);
	now += ms;
	inferences.hover(item);
}

describe("Inferences", () => {
	test("a side is armed after 1 s on it, not before", () => {
		hoverFor(side, 900);
		expect(inferences.lines({ frame })).toEqual([]);
		expect(inferences.nextChange()).toBe(100);
		now += 100;
		inferences.hover(side);
		expect(inferences.lines({ frame }).length).toBeGreaterThan(0);
	});

	test("moving off the side before then starts over", () => {
		hoverFor(side, 600);
		inferences.hover(null);
		hoverFor(side, 600);
		expect(inferences.lines({ frame })).toEqual([]);
	});

	test("an armed side gives its two extensions, rays of 30 m from its ends", () => {
		hoverFor(side, 1000);
		const lines = inferences.lines({ frame });
		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatchObject({
			origin: at(4, 0),
			ray: true,
			reach: EXTENSION_METRES,
			kind: "extension",
		});
		expect(lines[0]?.angle).toBeCloseTo(0, 6);
		expect(lines[1]).toMatchObject({ origin: at(0, 0), kind: "extension" });
		expect(lines[1]?.angle).toBeCloseTo(180, 6);
	});

	test("drawing from a corner, an armed side gives lines parallel and square to it", () => {
		hoverFor(side, 1000);
		const from = at(2, 5);
		const lines = inferences.lines({ from, frame });
		const parallel = lines.find((l) => l.kind === "parallel");
		const square = lines.find((l) => l.kind === "perpendicular");
		expect(parallel?.origin).toEqual(from);
		expect(parallel?.angle).toBeCloseTo(0, 6);
		expect(square?.origin).toEqual(from);
		expect(square?.angle).toBeCloseTo(90, 6);
	});

	test("a corner is armed after half a second: lines along the frame and its sides", () => {
		hoverFor(corner, 500);
		const lines = inferences.lines({ frame: { origin: O, angle: 10 } });
		expect(lines.every((l) => l.kind === "tracking")).toBe(true);
		expect(lines.every((l) => l.origin === corner.loc)).toBe(true);
		// The frame's 10° and 100°, and the sides' 0° and 45°.
		expect(lines.map((l) => l.angle).sort((a, b) => a - b)).toEqual([
			0, 10, 45, 100,
		]);
		expect(inferences.corners()).toEqual([corner.loc]);
	});

	test("a corner's lines don't repeat a direction its sides share with the frame", () => {
		hoverFor(corner, 500);
		expect(inferences.lines({ frame }).map((l) => l.angle)).toEqual([
			0, 90, 45,
		]);
	});

	test("the corner drawn from gives no tracking lines (angle lines cover it)", () => {
		hoverFor(corner, 500);
		expect(inferences.lines({ from: corner.loc, frame })).toEqual([]);
	});

	test("armed things are forgotten 4 s after their last use", () => {
		hoverFor(side, 1000);
		inferences.hover(null);
		now += 3000;
		inferences.used();
		now += 3999;
		expect(inferences.lines({ frame })).toHaveLength(2);
		expect(inferences.nextChange()).toBe(1);
		now += 1;
		expect(inferences.lines({ frame })).toEqual([]);
		expect(inferences.nextChange()).toBeNull();
	});

	test("at most four sides are armed: the least recently used goes", () => {
		for (let i = 0; i < 5; i++) {
			hoverFor(
				{ kind: "side", key: `s${i}`, a: at(i * 10, 0), b: at(i * 10 + 4, 0) },
				1000,
			);
		}
		const origins = inferences.lines({ frame }).map((l) => l.origin);
		expect(origins).not.toContainEqual(at(4, 0));
		expect(origins).toContainEqual(at(44, 0));
		expect(origins).toHaveLength(8);
	});
});

describe("hoveredOf", () => {
	const graph = Graph.fromEntities([
		node("n1", {}, at(0, 0)),
		node("n2", {}, at(4, 0)),
		node("n3", {}, at(4, 3)),
		way("w1", ["n1", "n2", "n3", "n1"]),
	]);

	test("a side, by its nodes in either order, its midpoint included", () => {
		const segment = {
			way: "w1" as const,
			a: { id: "n2" as const, loc: at(4, 0) },
			b: { id: "n1" as const, loc: at(0, 0) },
		};
		expect(
			hoveredOf(graph, { kind: "segment", segment, loc: at(2, 0) }),
		).toMatchObject({ kind: "side", key: "n1 n2" });
		expect(
			hoveredOf(graph, {
				kind: "segment",
				segment,
				loc: at(2, 0),
				mark: "midpoint",
			})?.kind,
		).toBe("side");
		expect(
			hoveredOf(graph, {
				kind: "segment",
				segment,
				loc: at(2, 0),
				mark: "intersection",
			}),
		).toBeNull();
	});

	test("a node, with the directions of its sides (a closed way wraps)", () => {
		const hovered = hoveredOf(graph, { kind: "node", id: "n1", loc: at(0, 0) });
		expect(hovered?.kind).toBe("corner");
		const directions = sideDirections(graph, "n1").sort((a, b) => a - b);
		// To n2: east (0°); to n3: atan2(3, 4) = 36.87°.
		expect(directions).toHaveLength(2);
		expect(directions[0]).toBeCloseTo(0, 4);
		expect(directions[1]).toBeCloseTo(36.87, 2);
	});
});
