import { describe, expect, it } from "vitest";
import type { Segment } from "#lib/map/feature-store.ts";
import type { Loc } from "#lib/osm/entity.ts";
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

describe("snapAt with direction lines", () => {
	/** East from [0, 0]. */
	const east = { origin: [0, 0] as Loc, angle: 0 };
	const pointer = (x: number, y: number) => unproject({ x, y });

	it("snaps onto a line the pointer is near, from its origin", () => {
		const target = snapAt(
			{ x: 50, y: 3 },
			{ lines: [east] },
			project,
			8,
			pointer(50, 3),
		);
		expect(target?.kind).toBe("angle");
		expect(target?.loc[0]).toBeCloseTo(0.5, 6);
		expect(target?.loc[1]).toBeCloseTo(0, 6);
		if (target?.kind === "angle") {
			expect(target.guides).toEqual([{ from: [0, 0], to: target.loc }]);
		}
	});

	it("doesn't snap more than 5° off the line, however near on screen", () => {
		// 3 px off, 20 px from the origin: 8.5°.
		expect(
			snapAt({ x: 20, y: 3 }, { lines: [east] }, project, 8, pointer(20, 3)),
		).toBeNull();
	});

	it("doesn't snap more than 10 px off the line, however small the angle", () => {
		// 12 px off, 400 px from the origin: 1.7°.
		expect(
			snapAt(
				{ x: 400, y: 12 },
				{ lines: [east] },
				project,
				8,
				pointer(400, 12),
			),
		).toBeNull();
	});

	it("a node beats a line", () => {
		const target = snapAt(
			{ x: 50, y: 3 },
			{ lines: [east], nodes: [{ id: "n9", loc: [0.52, -0.05] }] },
			project,
			8,
			pointer(50, 3),
		);
		expect(target?.kind).toBe("node");
	});

	it("where the line crosses a side beats the side and the line", () => {
		const wall: Segment = {
			way: "w2",
			a: { id: "n4", loc: [0.6, -0.5] },
			b: { id: "n5", loc: [0.6, 0.5] },
		};
		const target = snapAt(
			{ x: 58, y: 3 },
			{ lines: [east], segments: [wall] },
			project,
			8,
			pointer(58, 3),
		);
		expect(target?.kind).toBe("segment");
		if (target?.kind !== "segment") return;
		expect(target.mark).toBe("intersection");
		expect(target.segment).toBe(wall);
		expect(target.loc[0]).toBeCloseTo(0.6, 6);
		expect(target.loc[1]).toBeCloseTo(0, 6);
	});

	it("where two lines cross", () => {
		// North from [0.5, -1].
		const north = { origin: [0.5, -1] as Loc, angle: 90 };
		const target = snapAt(
			{ x: 52, y: 2 },
			{ lines: [east, north] },
			project,
			8,
			pointer(52, 2),
		);
		expect(target?.kind).toBe("intersection");
		expect(target?.loc[0]).toBeCloseTo(0.5, 6);
		expect(target?.loc[1]).toBeCloseTo(0, 6);
	});

	it("a midpoint, when asked for, beats the rest of its side", () => {
		const target = snapAt(
			{ x: 52, y: 3 },
			{ segments: [side], midpoints: true },
			project,
		);
		expect(target?.kind === "segment" && target.mark).toBe("midpoint");
		expect(target?.loc[0]).toBeCloseTo(0.5, 6);
	});

	it("a locked direction takes the foot of what the pointer snaps to", () => {
		const target = snapAt(
			{ x: 70, y: -40 },
			{ lock: east, nodes: [{ id: "n9", loc: [0.7, 0.42] }] },
			project,
			8,
			pointer(70, -40),
		);
		expect(target?.kind).toBe("lock");
		expect(target?.loc[0]).toBeCloseTo(0.7, 6);
		expect(target?.loc[1]).toBeCloseTo(0, 6);
	});
});

describe("snapAt with a grid", () => {
	/** A north grid every 0.1° (10 px on this flat screen). */
	const grid = { frame: { origin: [0, 0] as Loc, angle: 0 }, step: 11_119.5 };
	const pointer = (x: number, y: number) => unproject({ x, y });

	it("snaps to the nearest crossing", () => {
		const target = snapAt(
			{ x: 21, y: -38 },
			{ grid },
			project,
			8,
			pointer(21, -38),
		);
		expect(target?.kind).toBe("grid");
		expect(target?.loc[0]).toBeCloseTo(0.2, 3);
		expect(target?.loc[1]).toBeCloseTo(0.4, 3);
	});

	it("a side beats the grid", () => {
		const target = snapAt(
			{ x: 21, y: 2 },
			{ grid, segments: [side] },
			project,
			8,
			pointer(21, 2),
		);
		expect(target?.kind).toBe("segment");
	});

	it("where a direction line crosses a grid line", () => {
		// A grid every 0.3°: 45° from [0, 0] crosses its lines x = 0.3 and y = 0.3 at (0.3, 0.3).
		const target = snapAt(
			{ x: 29, y: -28 },
			{
				grid: { ...grid, step: 11_119.5 * 3 },
				lines: [{ origin: [0, 0], angle: 45 }],
			},
			project,
			8,
			pointer(29, -28),
		);
		expect(target?.kind).toBe("intersection");
		expect(target?.loc[0]).toBeCloseTo(0.3, 3);
		expect(target?.loc[1]).toBeCloseTo(0.3, 3);
	});
});

describe("snapAt with inferences (C.4)", () => {
	it("catches a ray only ahead of its origin, with its kind on the guide", () => {
		const extension = {
			origin: [1, 0] as Loc,
			angle: 0,
			ray: true,
			kind: "extension" as const,
		};
		const ahead = snapAt(
			{ x: 150, y: 3 },
			{ lines: [extension] },
			project,
			8,
			[1.5, -0.03],
		);
		expect(ahead?.kind).toBe("angle");
		if (ahead?.kind !== "angle") return;
		expect(ahead.loc[0]).toBeCloseTo(1.5, 6);
		expect(ahead.loc[1]).toBeCloseTo(0, 6);
		expect(ahead.guides).toEqual([
			{ from: [1, 0], to: ahead.loc, kind: "extension" },
		]);
		expect(
			snapAt({ x: 50, y: 3 }, { lines: [extension] }, project, 8, [0.5, -0.03]),
		).toBeNull();
	});

	it("catches a line only within its reach, in metres", () => {
		// 60 km is about 0.54° at the equator.
		const line = { origin: [1, 0] as Loc, angle: 0, ray: true, reach: 60_000 };
		expect(
			snapAt({ x: 140, y: 3 }, { lines: [line] }, project, 8, [1.4, -0.03])
				?.kind,
		).toBe("angle");
		expect(
			snapAt({ x: 200, y: 3 }, { lines: [line] }, project, 8, [2, -0.03]),
		).toBeNull();
	});

	it("snaps to the foot of the perpendicular from the last corner onto a side", () => {
		const target = snapAt(
			{ x: 33, y: 3 },
			{ segments: [side], from: [0.3, 1] },
			project,
		);
		expect(target?.kind).toBe("segment");
		if (target?.kind !== "segment") return;
		expect(target.mark).toBe("perpendicular");
		expect(target.loc[0]).toBeCloseTo(0.3, 6);
		expect(target.loc[1]).toBeCloseTo(0, 6);
		expect(target.guides).toEqual([
			{ from: [0.3, 1], to: target.loc, kind: "perpendicular" },
		]);
	});

	it("leaves out a foot beyond the side's ends", () => {
		const target = snapAt(
			{ x: 103, y: 3 },
			{ segments: [side], from: [1.2, 1] },
			project,
		);
		expect(target?.kind === "segment" && target.mark).toBeFalsy();
	});

	it("snaps to where two sides cross without a node", () => {
		const across: Segment = {
			way: "w2",
			a: { id: "n5", loc: [0.5, -0.5] },
			b: { id: "n6", loc: [0.5, 0.5] },
		};
		const target = snapAt(
			{ x: 53, y: 4 },
			{ segments: [side, across], crossings: true },
			project,
		);
		expect(target?.kind).toBe("segment");
		if (target?.kind !== "segment") return;
		expect(target.mark).toBe("intersection");
		expect(target.loc[0]).toBeCloseTo(0.5, 6);
		expect(target.loc[1]).toBeCloseTo(0, 6);
		// Without the option, the nearest point on a side.
		expect(
			snapAt({ x: 53, y: 4 }, { segments: [side, across] }, project)?.loc,
		).not.toEqual(target.loc);
	});
});
