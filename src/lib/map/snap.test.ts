import { describe, expect, it } from "vitest";
import type { Loc } from "#lib/osm/entity.ts";
import type { Segment } from "./feature-store.ts";
import { areaAround, snapAt } from "./snap.ts";

/** A flat screen: one degree is 100 px, y down. Near the equator Mercator is close to it. */
const project = ([lon, lat]: Loc) => ({ x: lon * 100, y: -lat * 100 });
const unproject = ({ x, y }: { x: number; y: number }): Loc => [
	x / 100,
	-y / 100,
];

/** A side along the x axis, from 0 to 1° (0 to 100 px). */
const side: Segment = {
	way: "w1",
	a: { id: "n1", loc: [0, 0] },
	b: { id: "n2", loc: [1, 0] },
};

describe("snapAt", () => {
	it("snaps to a node first, even when a side is nearer", () => {
		const target = snapAt(
			{ x: 50, y: 2 },
			{ nodes: [{ id: "n3", loc: [0.55, 0] }], segments: [side] },
			project,
		);
		expect(target).toEqual({ kind: "node", id: "n3", loc: [0.55, 0] });
	});

	it("snaps onto a side where the pointer is nearest it", () => {
		const target = snapAt({ x: 25, y: 6 }, { segments: [side] }, project);
		expect(target?.kind).toBe("segment");
		if (target?.kind !== "segment") return;
		expect(target.segment).toBe(side);
		expect(target.loc[0]).toBeCloseTo(0.25, 6);
		expect(target.loc[1]).toBeCloseTo(0, 6);
	});

	it("snaps to a floor plan vertex only when no node or side is within reach", () => {
		const candidates = {
			segments: [side],
			planVertices: [[0.5, -0.05] as Loc],
		};
		expect(snapAt({ x: 50, y: 4 }, candidates, project)?.kind).toBe("segment");
		expect(snapAt({ x: 50, y: 10 }, candidates, project)).toEqual({
			kind: "plan",
			loc: [0.5, -0.05],
		});
	});

	it("snaps to nothing beyond 8 px", () => {
		expect(
			snapAt(
				{ x: 50, y: 9 },
				{ nodes: [{ id: "n3", loc: [0.5, 0] }], segments: [side] },
				project,
			),
		).toBeNull();
	});
});

describe("areaAround", () => {
	it("gives the ground under the square of 8 px around the point", () => {
		expect(areaAround({ x: 100, y: -100 }, unproject)).toEqual({
			west: 0.92,
			south: 0.92,
			east: 1.08,
			north: 1.08,
		});
	});
});
