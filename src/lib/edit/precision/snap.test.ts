import { describe, expect, it } from "vitest";
import type { Segment } from "#lib/map/feature-store.ts";
import type { Loc } from "#lib/osm/entity.ts";
import {
	fromLocal,
	fromMercator,
	local,
	toMercator,
} from "#lib/osm/geometry.ts";
import { guideEnds } from "./construction.ts";
import { areaAround, type DirectionLine, snapAt } from "./snap.ts";

/** Web Mercator as the map draws it, one degree of longitude 100 px, y down. */
const PX = 100 / ((6378137 * Math.PI) / 180);
const project = (loc: Loc) => {
	const [x, y] = toMercator(loc);
	return { x: x * PX, y: -y * PX };
};
const unproject = ({ x, y }: { x: number; y: number }): Loc =>
	fromMercator([x / PX, -y / PX]);

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
		const point = project([1, 1]);
		const area = areaAround(point, unproject);
		expect(area.west).toBeCloseTo(0.92, 9);
		expect(area.east).toBeCloseTo(1.08, 9);
		expect(area.south).toBeCloseTo(
			unproject({ ...point, y: point.y + 8 })[1],
			9,
		);
		expect(area.north).toBeCloseTo(
			unproject({ ...point, y: point.y - 8 })[1],
			9,
		);
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

describe("snapAt with construction guides (C.5)", () => {
	/** A guide straight up through x = 0.5°. */
	const guide = { origin: [0.5, 0] as Loc, angle: 90 };

	it("snaps onto a guide like onto a side", () => {
		const target = snapAt(project([0.53, 0.4]), { guides: [guide] }, project);
		expect(target?.kind).toBe("guide");
		expect(target?.loc[0]).toBeCloseTo(0.5, 6);
		expect(target?.loc[1]).toBeCloseTo(0.4, 6);
	});

	it("says which guide it snapped onto, so a guide can be placed from it", () => {
		const target = snapAt({ x: 53, y: -40 }, { guides: [guide] }, project);
		expect(target?.kind === "guide" && target.line).toEqual(guide);
	});

	it("snaps to where a guide crosses a side, as a point on the side", () => {
		const target = snapAt(
			{ x: 54, y: 3 },
			{ guides: [guide], segments: [side] },
			project,
		);
		expect(target?.kind).toBe("segment");
		if (target?.kind !== "segment") return;
		expect(target.mark).toBe("intersection");
		expect(target.loc[0]).toBeCloseTo(0.5, 6);
		expect(target.loc[1]).toBeCloseTo(0, 6);
	});

	it("snaps to where two guides cross, and where a direction line crosses a guide", () => {
		const across = { origin: [0, 0.3] as Loc, angle: 0 };
		const crossing = snapAt(
			{ x: 54, y: -27 },
			{ guides: [guide, across] },
			project,
		);
		expect(crossing?.kind).toBe("intersection");
		expect(crossing?.loc[0]).toBeCloseTo(0.5, 6);
		expect(crossing?.loc[1]).toBeCloseTo(0.3, 6);
		const lined = snapAt(
			{ x: 52, y: -48 },
			{ guides: [guide], lines: [{ origin: [0, 0], angle: 45 }] },
			project,
			8,
			[0.52, 0.48],
		);
		expect(lined?.kind).toBe("intersection");
		expect(lined?.loc[0]).toBeCloseTo(0.5, 4);
		expect(lined?.loc[1]).toBeCloseTo(0.5, 4);
	});
});

describe("snapAt with angled guides far from the equator", () => {
	// A square grid of guides turned 30° at 52.5°N, as placed with the guide tool, 4 m apart.
	const O: Loc = [13.4, 52.5];
	const rad = (30 * Math.PI) / 180;
	const along = (u: number, v: number) =>
		fromLocal(O, [
			u * Math.cos(rad) - v * Math.sin(rad),
			u * Math.sin(rad) + v * Math.cos(rad),
		]);
	const guides = [0, 4, 8].flatMap((k) => [
		{ origin: along(0, k), angle: 30 },
		{ origin: along(k, 0), angle: 120 },
	]);
	// Zoom 22: about 7 px per metre on screen.
	const scale = (2 ** 22 * 256) / (2 * Math.PI * 6378137);
	const screen = (loc: Loc) => {
		const [x, y] = toMercator(loc);
		return { x: x * scale, y: -y * scale };
	};

	/** Where two guides cross as the map draws them: straight lines 2 km long, in Mercator. */
	const drawnCrossing = (g: DirectionLine, h: DirectionLine): Loc => {
		const [g0, g1] = guideEnds(g, 2000);
		const [h0, h1] = guideEnds(h, 2000);
		const [ax, ay] = toMercator(g0);
		const [bx, by] = toMercator(g1);
		const [cx, cy] = toMercator(h0);
		const [dx, dy] = toMercator(h1);
		const [ex, ey] = [bx - ax, by - ay];
		const [fx, fy] = [dx - cx, dy - cy];
		const t = ((cx - ax) * fy - (cy - ay) * fx) / (ex * fy - ey * fx);
		return fromMercator([ax + t * ex, ay + t * ey]);
	};

	it("puts the corners of a room exactly on the crossings drawn", () => {
		for (const [i, j] of [
			[0, 1],
			[0, 5],
			[2, 5],
			[4, 3],
		] as const) {
			const drawn = drawnCrossing(
				guides[i] as DirectionLine,
				guides[j] as DirectionLine,
			);
			const p = screen(drawn);
			const target = snapAt(
				{ x: p.x + 2, y: p.y - 1 },
				{ guides },
				screen,
				8,
				drawn,
			);
			expect(target?.kind).toBe("intersection");
			const [east, north] = local(drawn, target?.loc ?? O);
			expect(Math.hypot(east, north)).toBeLessThan(0.0005);
		}
	});

	it("gives square corners", () => {
		const corner = (u: number, v: number) => {
			const p = screen(along(u, v));
			return snapAt({ x: p.x + 1, y: p.y + 1 }, { guides }, screen)?.loc as Loc;
		};
		const [ax, ay] = local(O, corner(0, 0));
		const [bx, by] = local(O, corner(8, 0));
		const [cx, cy] = local(O, corner(8, 4));
		const cos =
			((bx - ax) * (cx - bx) + (by - ay) * (cy - by)) /
			Math.hypot(bx - ax, by - ay) /
			Math.hypot(cx - bx, cy - by);
		expect(Math.abs(cos)).toBeLessThan(1e-6);
	});
});
