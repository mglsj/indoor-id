import { describe, expect, it } from "vitest";
import type { EntityId } from "#lib/osm/entity.ts";
import { local } from "#lib/osm/geometry.ts";
import { Graph } from "#lib/osm/graph.ts";
import { EditHistory } from "#lib/state/edit-history.svelte.ts";
import type { MapPoint } from "../mode.ts";
import { drawRectangleMode } from "./rectangle.ts";

const at = (lon: number, lat: number): MapPoint => ({
	point: { x: lon, y: lat },
	lngLat: [lon, lat],
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
});
const key = (k: string) =>
	({ key: k, ctrlKey: false, metaKey: false, altKey: false }) as KeyboardEvent;
const metres = (loc: readonly number[] | undefined) =>
	local([0, 0], loc ?? [0, 0]).map((v) => Math.round(v * 100) / 100 + 0);

function setup() {
	const history = new EditHistory(Graph.fromEntities([]));
	const finished: (EntityId | null)[] = [];
	const mode = drawRectangleMode({
		history,
		level: 2,
		snap: () => null,
		onfinish: (id) => finished.push(id),
		precision: {
			frameAt: (loc) => ({ origin: loc, angle: 0 }),
			step: () => null,
			units: () => "metric",
			show: () => {},
		},
	});
	const corners = () => {
		const way = history.graph.entity(finished[0] ?? "w0");
		if (way?.type !== "way") return [];
		return way.nodes.map((n) => {
			const node = history.graph.entity(n);
			return metres(node?.type === "node" ? node.loc : undefined);
		});
	};
	return { history, finished, mode, corners };
}

describe("drawRectangleMode", () => {
	it("draws from two opposite corners in one undo step, an area on the level", () => {
		const { history, finished, mode, corners } = setup();
		mode.click?.(at(0, 0));
		mode.hover?.(at(0.00003, 0.00002));
		mode.click?.(at(0.00003, 0.00002));
		expect(finished).toHaveLength(1);
		const way = history.graph.entity(finished[0] ?? "w0");
		expect(way?.tags).toEqual({ area: "yes", level: "2" });
		expect(corners()).toHaveLength(5);
		expect(corners()[0]).toEqual(corners()[4]);
		history.undo();
		expect(history.graph.hasChanges()).toBe(false);
	});

	it("takes a typed width;depth towards the pointer", () => {
		const { mode, corners } = setup();
		mode.click?.(at(0, 0));
		mode.hover?.(at(-0.001, 0.001));
		for (const k of ["4", ";", "3", "Enter"]) mode.key?.(key(k));
		expect(corners().slice(0, 4)).toEqual([
			[0, 0],
			[-4, 0],
			[-4, 3],
			[0, 3],
		]);
	});

	it("draws from a side and a width after Tab", () => {
		const { mode, corners } = setup();
		mode.key?.(key("Tab"));
		mode.click?.(at(0, 0));
		mode.hover?.(at(0, 0.001));
		for (const k of ["5", "Enter"]) mode.key?.(key(k));
		mode.hover?.(at(0.001, 0.0001));
		for (const k of ["2", "Enter"]) mode.key?.(key(k));
		expect(corners().slice(0, 4)).toEqual([
			[0, 0],
			[0, 5],
			[2, 5],
			[2, 0],
		]);
	});

	it("Escape draws nothing", () => {
		const { history, finished, mode } = setup();
		mode.click?.(at(0, 0));
		mode.hover?.(at(0.001, 0.001));
		mode.key?.(key("Escape"));
		expect(finished).toEqual([null]);
		expect(history.graph.hasChanges()).toBe(false);
	});
});
