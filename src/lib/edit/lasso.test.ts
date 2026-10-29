import { describe, expect, it } from "vitest";
import type { Loc, NodeId } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { featuresInLasso, lassoDrag } from "./lasso.ts";
import type { MapPoint } from "./mode.ts";

/** A room w1 (0–2) with a door n1 on its side and a toilet n6 in it; a room w2 (3–5). */
const graph = () =>
	Graph.fromEntities([
		node("n1", { door: "yes" }, [0, 0]),
		node("n2", {}, [2, 0]),
		node("n3", {}, [2, 2]),
		node("n4", {}, [0, 2]),
		way("w1", ["n1", "n2", "n3", "n4", "n1"], { indoor: "room" }),
		node("n6", { amenity: "toilets" }, [1, 1]),
		node("n7", {}, [3, 0]),
		node("n8", {}, [5, 0]),
		node("n9", {}, [5, 2]),
		way("w2", ["n7", "n8", "n9", "n7"], { indoor: "room" }),
	]);

const drawn = (g: Graph) =>
	[...g.entities()].flatMap((e) =>
		e.type === "node" ? [{ id: e.id as NodeId, loc: e.loc }] : [],
	);

const box = (w: number, s: number, e: number, n: number): Loc[] => [
	[w, s],
	[e, s],
	[e, n],
	[w, n],
];

describe("featuresInLasso", () => {
	it("selects the ways entirely inside, the points and the tagged vertices", () => {
		const g = graph();
		expect(featuresInLasso(g, box(-0.5, -0.5, 2.5, 2.5), drawn(g))).toEqual([
			"n1",
			"n6",
			"w1",
		]);
	});

	it("leaves out ways only partly inside", () => {
		const g = graph();
		expect(featuresInLasso(g, box(2.5, -0.5, 4, 2.5), drawn(g))).toEqual([]);
	});

	it("needs a lasso of three points at least", () => {
		const g = graph();
		expect(
			featuresInLasso(
				g,
				[
					[0, 0],
					[9, 9],
				],
				drawn(g),
			),
		).toEqual([]);
	});
});

describe("lassoDrag", () => {
	const at = (x: number, y: number): MapPoint => ({
		point: { x, y },
		lngLat: [x, y],
		shiftKey: true,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
	});

	it("shows the lasso closed while dragging, and hands it over on release", () => {
		const shown: (readonly Loc[])[] = [];
		const ended: (readonly Loc[])[] = [];
		const drag = lassoDrag([0, 0], {
			onchange: (l) => shown.push(l),
			onend: (l) => ended.push(l),
		});
		drag.move(at(1, 0));
		drag.move(at(1, 1));
		expect(shown.at(-1)).toEqual([
			[0, 0],
			[1, 0],
			[1, 1],
			[0, 0],
		]);
		drag.end(at(1, 1));
		expect(shown.at(-1)).toEqual([]);
		expect(ended).toEqual([
			[
				[0, 0],
				[1, 0],
				[1, 1],
			],
		]);
	});
});
