import { describe, expect, it } from "vitest";
import { msg } from "#lib/i18n/messages.ts";
import type { SnapTarget } from "#lib/map/snap.ts";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { placePoint } from "./place-point.ts";

/**
 * A building n1–n2–n3–n4, a room on level 0 sharing its side n1–n2, and a wall n5–n6 inside.
 */
const graph = () =>
	Graph.fromEntities([
		node("n1", {}, [0, 0]),
		node("n2", {}, [2, 0]),
		node("n3", {}, [2, 2]),
		node("n4", {}, [0, 2]),
		node("n5", {}, [1, 0]),
		node("n6", {}, [1, 2]),
		node("n7", { amenity: "toilets" }, [1.5, 1]),
		way("w1", ["n1", "n2", "n3", "n4", "n1"], { building: "yes" }),
		way("w2", ["n1", "n2", "n6", "n5", "n1"], { indoor: "room", level: "0" }),
		way("w3", ["n5", "n6"], { indoor: "wall", level: "0" }),
	]);

const side = (
	a: "n1" | "n5",
	b: "n2" | "n6",
	loc: [number, number],
): SnapTarget => ({
	kind: "segment",
	segment: {
		way: "w3",
		a: { id: a, loc: [0, 0] },
		b: { id: b, loc: [0, 0] },
	},
	loc,
});

describe("placePoint", () => {
	it("makes a door on an indoor side, in every way with that side", () => {
		const g = graph();
		const placed = placePoint(g, [1.01, 1], side("n5", "n6", [1, 1]), 0);
		expect(placed?.kind).toBe("door");
		expect(placed?.annotation).toEqual(msg("undo_add_door"));
		const after = placed?.action(g);
		const id = placed?.id ?? "n0";
		expect(after?.entity(id)).toMatchObject({
			loc: [1, 1],
			tags: { indoor: "door", door: "yes" },
		});
		expect(after?.entity("w3")).toMatchObject({ nodes: ["n5", id, "n6"] });
		expect(after?.entity("w2")).toMatchObject({
			nodes: ["n1", "n2", "n6", id, "n5", "n1"],
		});
	});

	it("makes an entrance on the building's outline, on the shown level", () => {
		const g = graph();
		const placed = placePoint(g, [0.5, 0], side("n1", "n2", [0.5, 0]), 0);
		expect(placed?.kind).toBe("entrance");
		const after = placed?.action(g);
		const id = placed?.id ?? "n0";
		expect(after?.entity(id)?.tags).toEqual({
			entrance: "yes",
			door: "yes",
			level: "0",
		});
		// In the building and in the room along it.
		expect(after?.parentWays(id).map((w) => w.id)).toEqual(["w1", "w2"]);
	});

	it("turns an untagged corner into the door", () => {
		const g = graph();
		const placed = placePoint(
			g,
			[1, 0],
			{ kind: "node", id: "n5", loc: [1, 0] },
			0,
		);
		expect(placed?.id).toBe("n5");
		expect(placed?.action(g).entity("n5")?.tags).toEqual({
			indoor: "door",
			door: "yes",
		});
	});

	it("makes nothing on a node already tagged", () => {
		expect(
			placePoint(
				graph(),
				[1.5, 1],
				{ kind: "node", id: "n7", loc: [1.5, 1] },
				0,
			),
		).toBeNull();
	});

	it("makes a point on the shown level elsewhere, at a plan vertex when snapped to one", () => {
		const g = graph();
		const free = placePoint(g, [1.5, 1.5], null, 2);
		expect(free?.kind).toBe("point");
		expect(free?.action(g).entity(free.id)).toMatchObject({
			loc: [1.5, 1.5],
			tags: { level: "2" },
		});
		const onPlan = placePoint(
			g,
			[1.5, 1.5],
			{ kind: "plan", loc: [1.6, 1.6] },
			2,
		);
		expect(onPlan?.action(g).entity(onPlan.id)).toMatchObject({
			loc: [1.6, 1.6],
		});
	});
});
