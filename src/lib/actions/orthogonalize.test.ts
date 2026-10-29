import { describe, expect, it } from "vitest";
import type { Loc } from "#lib/osm/entity.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { toMercator } from "#lib/osm/geometry.ts";
import type { Graph as GraphType } from "#lib/osm/graph.ts";
import { Graph } from "#lib/osm/graph.ts";
import { orthogonalize, orthogonalizeRefusal } from "./orthogonalize.ts";

/** A closed way through these positions (degrees, tiny so Mercator is nearly flat). */
function shape(...locs: Loc[]) {
	const ids = locs.map((_, i) => `n${i + 1}` as const);
	return Graph.fromEntities([
		...locs.map((loc, i) => node(ids[i] as `n${number}`, {}, loc)),
		way("w1", [...ids, "n1"], { indoor: "room" }),
	]);
}

const D = 0.0001;

/** The angle at each corner, in degrees, as drawn. */
function angles(graph: GraphType, ids: `n${number}`[]): number[] {
	const pts = ids.map((id) => {
		const n = graph.entity(id);
		return toMercator(n?.type === "node" ? n.loc : [0, 0]);
	});
	return pts.map((p, i) => {
		const a = pts[(i - 1 + pts.length) % pts.length] as number[];
		const c = pts[(i + 1) % pts.length] as number[];
		const v = [(a[0] ?? 0) - (p[0] ?? 0), (a[1] ?? 0) - (p[1] ?? 0)];
		const w = [(c[0] ?? 0) - (p[0] ?? 0), (c[1] ?? 0) - (p[1] ?? 0)];
		const cos =
			((v[0] ?? 0) * (w[0] ?? 0) + (v[1] ?? 0) * (w[1] ?? 0)) /
			(Math.hypot(v[0] ?? 0, v[1] ?? 0) * Math.hypot(w[0] ?? 0, w[1] ?? 0));
		return (Math.acos(cos) * 180) / Math.PI;
	});
}

describe("orthogonalize", () => {
	it("squares a room drawn a few degrees off", () => {
		// A quadrilateral with corners about 5° off square.
		const g = shape([0, 0], [D, 0.08 * D], [D * 0.95, D], [-0.05 * D, D]);
		expect(orthogonalizeRefusal(g, "w1")).toBeNull();
		const after = orthogonalize("w1")(g);
		for (const angle of angles(after, ["n1", "n2", "n3", "n4"])) {
			expect(angle).toBeCloseTo(90, 1);
		}
	});

	it("puts a node on a straight side back on the line", () => {
		const g = shape([0, 0], [D / 2, 0.02 * D], [D, 0.05 * D], [D, D], [0, D]);
		const after = orthogonalize("w1")(g);
		const result = angles(after, ["n1", "n2", "n3", "n4", "n5"]);
		expect(result[1]).toBeCloseTo(180, 1);
		for (const i of [0, 2, 3, 4]) expect(result[i]).toBeCloseTo(90, 1);
	});

	it("refuses a shape that isn't squarish, one already square, and a line", () => {
		const triangle = shape([0, 0], [D, 0], [D / 2, D]);
		expect(orthogonalizeRefusal(triangle, "w1")).toBe("not_squarish");
		const square = shape([0, 0], [D, 0], [D, D], [0, D]);
		expect(orthogonalizeRefusal(square, "w1")).toBe("square_enough");
		const line = Graph.fromEntities([
			node("n1"),
			node("n2", {}, [D, 0]),
			way("w2", ["n1", "n2"]),
		]);
		expect(orthogonalizeRefusal(line, "w2")).toBe("not_area");
	});
});
